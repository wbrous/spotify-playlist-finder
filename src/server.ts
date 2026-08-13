import { unlink } from "node:fs/promises";
import { NativeImage } from "@opentui/core";
import { SpotifyClient } from "./spotify";
import { confidence, hashFromNativeImage, hashFromUrl, type ImageHash } from "./imageHash";
import type { RankedPlaylistHit } from "./types";

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.\n" +
      "Set them in .env (see .env.example) before running.",
  );
  process.exit(1);
}

const spotify = new SpotifyClient(clientId, clientSecret);
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname;

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

function parseSearchParams(
  get: (key: string) => string | null,
): { title: string; keywords: string; exactTitle: boolean; ownerPattern?: RegExp } | { error: string } {
  const title = (get("title") ?? "").trim();
  if (!title) return { error: "title is required" };
  const keywords = (get("keywords") ?? "").trim();
  const exactTitle = get("exact") === "true";

  const ownerPatternSource = (get("ownerPattern") ?? "").trim();
  let ownerPattern: RegExp | undefined;
  if (ownerPatternSource) {
    try {
      ownerPattern = new RegExp(ownerPatternSource, "i");
    } catch {
      return { error: `Invalid owner-name regex: ${ownerPatternSource}` };
    }
  }

  return { title, keywords, exactTitle, ownerPattern };
}

function jsonGetter(body: Record<string, unknown>): (key: string) => string | null {
  return (key) => (typeof body[key] === "string" ? (body[key] as string) : null);
}

function formGetter(form: { get(key: string): unknown }): (key: string) => string | null {
  return (key) => {
    const value = form.get(key);
    return typeof value === "string" ? value : null;
  };
}

async function rankByCover(
  opts: { title: string; keywords: string; exactTitle: boolean; ownerPattern?: RegExp },
  targetHash: ImageHash,
): Promise<RankedPlaylistHit[]> {
  const candidates = await spotify.search({ ...opts, maxResults: 100 });
  const ranked: RankedPlaylistHit[] = [];

  for (const hit of candidates) {
    let coverUrl = hit.images[0]?.url;
    if (!coverUrl) coverUrl = (await spotify.fetchCoverUrl(hit.id)) ?? undefined;
    if (!coverUrl) {
      ranked.push({ ...hit, confidence: 0 });
      continue;
    }
    const candidateHash = await hashFromUrl(coverUrl);
    const score = candidateHash === null ? 0 : confidence(targetHash, candidateHash);
    ranked.push({ ...hit, confidence: score });
  }

  ranked.sort((a, b) => b.confidence - a.confidence);
  return ranked;
}

async function hashUpload(file: File): Promise<ImageHash> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tmpPath = `${PUBLIC_DIR}../.tmp-upload-${crypto.randomUUID()}`;
  await Bun.write(tmpPath, bytes);
  try {
    const image = await NativeImage.load(tmpPath);
    try {
      return hashFromNativeImage(image);
    } finally {
      image.dispose();
    }
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const filePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
      const file = Bun.file(`${PUBLIC_DIR}${filePath}`);
      if (await file.exists()) return new Response(file);
      if (url.pathname === "/") return new Response("index.html missing", { status: 500 });
      // fall through to 404 below for unknown API GETs
    }

    if (req.method === "POST" && url.pathname === "/api/search-name") {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        const parsed = parseSearchParams(jsonGetter(body));
        if ("error" in parsed) return json({ error: parsed.error }, { status: 400 });
        const hits = await spotify.search(parsed);
        return json({ hits });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/search-image") {
      try {
        const form = await req.formData();
        const file = form.get("image");
        if (!(file instanceof File)) return json({ error: "image file is required" }, { status: 400 });
        const parsed = parseSearchParams(formGetter(form));
        if ("error" in parsed) return json({ error: parsed.error }, { status: 400 });

        const targetHash = await hashUpload(file);
        const hits = await rankByCover(parsed, targetHash);
        return json({ hits });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    }

    return json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Spotify Playlist Finder listening on http://localhost:${PORT}`);
