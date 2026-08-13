# Spotify Playlist Finder

A small [Bun](https://bun.sh) web app for finding Spotify playlists two ways: by name, and by cover-art image. Both panes share the same search controls:

- **Title** — the playlist name to search for.
- **Keywords** — optional free text (artist, song names, genre, etc.) appended to the query to widen or steer the search.
- **Exact wording** checkbox — when checked, only playlists whose name is a case-sensitive exact match for Title are kept (Spotify's own search fuzzy-matches otherwise). Unchecked, every playlist Spotify returns for Title + Keywords is kept, ordered as Spotify ranks them.
- **Playlist maker** — filters results to owner display names matching a regex. Pick a preset (`First Last`, `First name only`, `Last, First`) or choose *Custom regex&hellip;* to type your own pattern (matched case-insensitively).

Search pages through every offset Spotify's search endpoint allows (in batches of 50, up to the API's hard `offset + limit ≤ 1000` ceiling — there's no way to search further than that via the public search endpoint, and this app never trusts Spotify's early-stop signals, so it always walks the full window).

**Known limitation (Spotify's, not this app's):** Spotify's `/v1/search?type=playlist` index is documented and widely reported to be incomplete — it does not reliably surface every public playlist matching a query, even with correct exhaustive pagination ([spotify/web-api#1096](https://github.com/spotify/web-api/issues/1096), multiple Spotify community threads). For a common title, expect the API to return only a fraction of the playlists that actually exist. There is no client-side workaround; this is a Spotify-side search-quality limitation.

**Image search** additionally lets you upload or paste a cover image or a screenshot, crop the cover art out of it with the in-browser crop tool, and ranks the Title/Keywords/owner-filtered candidates by visual similarity to your crop (a perceptual hash / confidence score), sorted best match first. Low-confidence matches are still shown, just ranked near the bottom — nothing is silently excluded.

## Setup

1. Create a Spotify app at the [developer dashboard](https://developer.spotify.com/dashboard) (client credentials only — no user login/redirect URI needed).
2. `cp .env.example .env` and fill in `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
3. `bun install`
4. `bun start`
5. Open `http://localhost:3000` (override the port with `PORT=xxxx bun start`).

During development, `bun run dev` restarts the server automatically on file changes.

## Usage

### Name search

Fill in Title (and optionally Keywords / Exact wording / Playlist maker) and hit Search.

### Image search

1. Choose an image file (a cover image, or a screenshot containing one).
2. Drag on the canvas to select just the cover-art region — the selection updates live.
3. Fill in Title/Keywords/Exact wording/Playlist maker as with name search, then hit Search. This gathers matching candidate playlists from Spotify search and ranks them by how closely their cover art matches your cropped region — best matches first, worse matches still included further down the grid.

Image matching uses a difference-hash (dHash) computed directly from decoded pixels (via `@opentui/core`'s native image decoder, used server-side purely for its image codec — no browser rendering involved), so no extra image-processing dependency is required.

## Architecture

- `src/spotify.ts` — client-credentials Spotify API client (`SpotifyClient.search`, `fetchCoverUrl`), zod-validated responses.
- `src/imageHash.ts` — dHash perceptual hashing + confidence scoring.
- `src/server.ts` — Bun HTTP server: serves `public/` statically and exposes `POST /api/search-name` and `POST /api/search-image`.
- `public/` — the frontend: plain HTML/CSS/JS, canvas-based crop tool, no build step.

## Requirements

- Bun.
- Any modern browser (the crop tool uses `<canvas>` + Pointer Events).
