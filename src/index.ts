import { SpotifyClient } from "./spotify";
import { runApp } from "./ui/app";

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.\n" +
      "Create a Spotify app at https://developer.spotify.com/dashboard, then either:\n" +
      "  - copy .env.example to .env and fill in the values, or\n" +
      "  - export SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... before running.",
  );
  process.exit(1);
}

const spotify = new SpotifyClient(clientId, clientSecret);

await runApp(spotify);
