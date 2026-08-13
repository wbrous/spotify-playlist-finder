# Spotify Playlist Finder

A small [Bun](https://bun.sh) web app for finding Spotify playlists two ways:

1. **Exact name search** — Spotify's search API fuzzy-matches, so this filters results down to playlists whose name is an **exact, case-sensitive** match for what you typed. It pages through every result Spotify's search endpoint allows (in batches of 50, up to the API's hard `offset + limit ≤ 1000` ceiling — there's no way to search further than that via the public search endpoint).
2. **Image search** — upload or paste a cover image or a screenshot, crop the cover art out of it with the in-browser crop tool, add a few search keywords, and it ranks broad search candidates by visual similarity to your crop (a perceptual hash / confidence score), sorted best match first. Low-confidence matches are still shown, just ranked near the bottom — nothing is silently excluded.

## Setup

1. Create a Spotify app at the [developer dashboard](https://developer.spotify.com/dashboard) (client credentials only — no user login/redirect URI needed).
2. `cp .env.example .env` and fill in `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
3. `bun install`
4. `bun start`
5. Open `http://localhost:3000` (override the port with `PORT=xxxx bun start`).

## Usage

### Name search

Type a playlist name and hit Search. Only playlists whose name matches exactly (including case) are listed.

### Image search

1. Choose an image file (a cover image, or a screenshot containing one).
2. Drag on the canvas to select just the cover-art region — the selection updates live.
3. Enter broad search keywords (e.g. words from the playlist name/genre/artist) and hit Search. This gathers candidate playlists from Spotify search and ranks them by how closely their cover art matches your cropped region — best matches first, worse matches still included further down the grid.

Image matching uses a difference-hash (dHash) computed directly from decoded pixels (via `@opentui/core`'s native image decoder, used server-side purely for its image codec — no browser rendering involved), so no extra image-processing dependency is required.

## Architecture

- `src/spotify.ts` — client-credentials Spotify API client (`searchExact`, `searchBroad`, `fetchCoverUrl`), zod-validated responses.
- `src/imageHash.ts` — dHash perceptual hashing + confidence scoring.
- `src/server.ts` — Bun HTTP server: serves `public/` statically and exposes `POST /api/search-exact` and `POST /api/search-image`.
- `public/` — the frontend: plain HTML/CSS/JS, canvas-based crop tool, no build step.

## Requirements

- Bun.
- Any modern browser (the crop tool uses `<canvas>` + Pointer Events).
