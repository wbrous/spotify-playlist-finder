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

async function rankByCover(query: string, targetHash: ImageHash): Promise<RankedPlaylistHit[]> {
  const [broad, exact] = await Promise.all([spotify.searchBroad(query, 100), spotify.searchExact(query)]);

  const byId = new Map(broad.map((hit) => [hit.id, hit]));
  for (const hit of exact) byId.set(hit.id, hit); // exact-name hits always included, even if broad search missed them
  const candidates = [...byId.values()];

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

    if (req.method === "POST" && url.pathname === "/api/search-exact") {
      try {
        const body = (await req.json()) as { query?: unknown };
        const query = typeof body.query === "string" ? body.query.trim() : "";
        if (!query) return json({ error: "query is required" }, { status: 400 });
        const hits = await spotify.searchExact(query);
        return json({ hits });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/search-image") {
      try {
        const form = await req.formData();
        const file = form.get("image");
        const query = String(form.get("query") ?? "").trim();
        if (!(file instanceof File)) return json({ error: "image file is required" }, { status: 400 });
        if (!query) return json({ error: "query is required" }, { status: 400 });

        const targetHash = await hashUpload(file);
        const hits = await rankByCover(query, targetHash);
        return json({ hits });
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    }

    return json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Spotify Playlist Finder listening on http://localhost:${PORT}`);
