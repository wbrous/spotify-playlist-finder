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
   * Searches playlists by title (optionally quoted for exact-phrase matching)
   * plus free-text keywords (artist/song names etc.), then filters locally.
   *
   * - `exactTitle: true` keeps only hits whose name is a case-sensitive exact
   *   match for `title`. Otherwise every hit Spotify returns for the combined
   *   query is kept (still ranked/ordered as Spotify returns them).
   * - `ownerPattern`, if given, filters to hits whose owner display name
   *   matches the regex.
   * - Paginates in pages of `SEARCH_PAGE_SIZE` until Spotify has nothing left
   *   or `maxResults` is reached, up to Spotify's hard `SEARCH_MAX_OFFSET`
   *   ceiling (offset + limit <= 1000 — a documented API limit, not ours).
   */
  async search(opts: {
    title: string;
    keywords?: string;
    exactTitle?: boolean;
    ownerPattern?: RegExp;
    maxResults?: number;
    onProgress?: (fetched: number) => void;
  }): Promise<PlaylistHit[]> {
    const title = opts.title.trim();
    const keywords = (opts.keywords ?? "").trim();
    const exactTitle = opts.exactTitle ?? false;
    const maxResults = opts.maxResults ?? Infinity;

    // Spotify's search syntax treats a quoted string as a phrase match, which
    // narrows results to that phrase instead of any-word-matches-anywhere.
    // Still not guaranteed case-sensitive-exact, so we keep filtering locally.
    const titleTerm = title ? (exactTitle ? `"${title.replace(/"/g, "")}"` : title) : "";
    const q = [titleTerm, keywords].filter(Boolean).join(" ").trim();
    if (!q) return [];

    const results: PlaylistHit[] = [];
    let offset = 0;
    let fetched = 0;

    while (offset < SEARCH_MAX_OFFSET && results.length < maxResults) {
      const limit = Math.min(SEARCH_PAGE_SIZE, SEARCH_MAX_OFFSET - offset);
      const json = await this.request("/search", { q, type: "playlist", limit: String(limit), offset: String(offset) });

      const items = json.playlists?.items ?? [];
      if (items.length === 0) break;

      for (const raw of items) {
        fetched++;
        if (!raw) continue;
        if (exactTitle && raw.name !== title) continue;
        const hit = toPlaylistHit(raw);
        if (opts.ownerPattern && !opts.ownerPattern.test(hit.ownerName)) continue;
        results.push(hit);
        if (results.length >= maxResults) break;
      }
      opts.onProgress?.(fetched);

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
