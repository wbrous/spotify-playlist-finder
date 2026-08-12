# Spotify Playlist Finder

A terminal UI (built with [Bun](https://bun.sh) + [OpenTUI](https://opentui.com)) for finding Spotify playlists two ways:

1. **Exact name search** — Spotify's search API fuzzy-matches, so this filters results down to playlists whose name is an **exact, case-sensitive** match for what you typed.
2. **Image search** — point it at a cover image or a screenshot, crop the cover art out of it with the built-in cropping tool, and it ranks broad search candidates by visual similarity to your crop (a perceptual hash / confidence score), sorted best match first. Low-confidence matches are still shown, just ranked near the bottom — nothing is silently excluded.

## Setup

1. Create a Spotify app at the [developer dashboard](https://developer.spotify.com/dashboard) (client credentials only — no user login/redirect URI needed).
2. `cp .env.example .env` and fill in `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.
3. `bun install`
4. `bun start`

## Usage

- `F1` / `F2` — switch between the Name Search and Image Search tabs.
- `Tab` / `Shift+Tab` — cycle focus between inputs and the results list.
- `Ctrl+C` — quit.

### Name search

Type a playlist name and press `Enter`. Only playlists whose name matches exactly (including case) are listed, sorted as returned by Spotify. Use the results list to browse; the right-hand panel previews the cover art and details of the highlighted playlist.

### Image search

1. Enter a path to a local image (a full cover image or a screenshot that contains one) and press `Enter`.
2. A cropping screen opens with the image stretched into the terminal. Move the selection with the arrow keys, resize it with `Shift+Arrow`, and press `Enter` to confirm the crop (or `Esc` to start over with a different image).
3. Enter broad search keywords (e.g. words from the playlist name/genre) and press `Enter`. This gathers candidate playlists from Spotify search and re-ranks them by how closely their cover art matches your cropped region — best matches first, worse matches still included further down the list.

Image matching uses a difference-hash (dHash) computed directly from decoded pixels (via OpenTUI's native image decoder), so no external image-processing dependency is required.

## Requirements

- Bun (native image/terminal-graphics rendering is Bun-exclusive for OpenTUI).
- A terminal with Kitty, Sixel, or Unicode-block image support for cover art previews (OpenTUI falls back automatically).
