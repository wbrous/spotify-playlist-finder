import { z } from "zod";
import type { PlaylistHit, SpotifyImage } from "./types";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const SEARCH_PAGE_SIZE = 50;
const SEARCH_MAX_OFFSET = 1000; // Spotify search endpoint hard limit (offset + limit <= 1000)

export class SpotifyAuthError extends Error {}

interface TokenState {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

const SpotifyImageSchema = z.object({
  url: z.string(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});

// Spotify's search endpoint intersperses `null` entries for playlists it can no
// longer resolve (deleted/private). Everything else is optional-ish, so we only
// hard-require the fields we actually use.
const PlaylistItemSchema = z
  .object({
    id: z.string(),
    name: z.string().default(""),
    description: z.string().nullable().optional(),
    public: z.boolean().nullable().optional(),
    external_urls: z.object({ spotify: z.string().optional() }).optional(),
    owner: z
      .object({
        id: z.string().optional(),
        display_name: z.string().nullable().optional(),
      })
      .optional(),
    images: z.array(SpotifyImageSchema).nullable().optional(),
    tracks: z.object({ total: z.number().optional() }).optional(),
  })
  .nullable();

const SearchResponseSchema = z.object({
  playlists: z
    .object({
      items: z.array(PlaylistItemSchema).default([]),
      total: z.number().default(0),
    })
    .optional(),
});

type PlaylistItem = NonNullable<z.infer<typeof PlaylistItemSchema>>;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function toPlaylistHit(item: PlaylistItem): PlaylistHit {
  const images: SpotifyImage[] = (item.images ?? [])
    .filter((img): img is z.infer<typeof SpotifyImageSchema> => Boolean(img?.url))
    .map((img) => ({ url: img.url, width: img.width ?? null, height: img.height ?? null }));

  return {
    id: item.id,
    name: item.name,
    ownerName: item.owner?.display_name ?? item.owner?.id ?? "unknown",
    ownerId: item.owner?.id ?? "",
    url: item.external_urls?.spotify ?? `https://open.spotify.com/playlist/${item.id}`,
    images,
    tracksTotal: item.tracks?.total ?? 0,
    description: item.description ?? "",
    public: item.public ?? null,
  };
}

export class SpotifyClient {
  private clientId: string;
  private clientSecret: string;
  private token: TokenState | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5_000) {
      return this.token.accessToken;
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SpotifyAuthError(`Spotify auth failed (${res.status}): ${body}`);
    }

    const json = TokenResponseSchema.parse(await res.json());
    this.token = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.accessToken;
  }

  private async request(path: string, params: Record<string, string>): Promise<z.infer<typeof SearchResponseSchema>> {
    const token = await this.getToken();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
      await delay((retryAfter + 0.2) * 1000);
      return this.request(path, params);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Spotify API error (${res.status}) on ${path}: ${body}`);
    }

    return SearchResponseSchema.parse(await res.json());
  }

  /**
   * Fetches every playlist page Spotify will give us for `query` and returns
   * only the hits whose name is an exact, case-sensitive match.
   */
  async searchExact(query: string, onProgress?: (fetched: number) => void): Promise<PlaylistHit[]> {
    const exact: PlaylistHit[] = [];
    let offset = 0;
    let fetched = 0;

    // Spotify's search syntax treats a quoted string as a phrase match, which
    // narrows results to that phrase instead of any-word-matches-anywhere.
    // Still not guaranteed case-sensitive-exact, so we keep filtering locally.
    const phraseQuery = `"${query.replace(/"/g, "")}"`;

    while (offset < SEARCH_MAX_OFFSET) {
      const limit = Math.min(SEARCH_PAGE_SIZE, SEARCH_MAX_OFFSET - offset);
      const json = await this.request("/search", { q: phraseQuery, type: "playlist", limit: String(limit), offset: String(offset) });

      const items = json.playlists?.items ?? [];
      if (items.length === 0) break;

      for (const raw of items) {
        fetched++;
        if (raw && raw.name === query) exact.push(toPlaylistHit(raw));
      }
      onProgress?.(fetched);

      const total = json.playlists?.total ?? 0;
      offset += items.length;
      if (offset >= total) break;
    }

    return exact;
  }

  /**
   * Broad candidate search used to feed the image-similarity ranker.
   * Not filtered by exact name; caller re-ranks by cover confidence.
   */
  async searchBroad(query: string, maxResults = 100, onProgress?: (fetched: number) => void): Promise<PlaylistHit[]> {
    const results: PlaylistHit[] = [];
    let offset = 0;
    let fetched = 0;

    while (offset < SEARCH_MAX_OFFSET && results.length < maxResults) {
      const limit = Math.min(SEARCH_PAGE_SIZE, SEARCH_MAX_OFFSET - offset, maxResults - results.length);
      if (limit <= 0) break;
      const json = await this.request("/search", { q: query, type: "playlist", limit: String(limit), offset: String(offset) });

      const items = json.playlists?.items ?? [];
      if (items.length === 0) break;

      for (const raw of items) {
        fetched++;
        if (raw) results.push(toPlaylistHit(raw));
      }
      onProgress?.(fetched);

      const total = json.playlists?.total ?? 0;
      offset += items.length;
      if (offset >= total) break;
    }

    return results;
  }

  /** Fallback for playlists whose search hit carried no images. */
  async fetchCoverUrl(playlistId: string): Promise<string | null> {
    try {
      const token = await this.getToken();
      const res = await fetch(`${API_BASE}/playlists/${playlistId}/images`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const images = z.array(SpotifyImageSchema).parse(await res.json());
      return images[0]?.url ?? null;
    } catch {
      return null;
    }
  }
}
