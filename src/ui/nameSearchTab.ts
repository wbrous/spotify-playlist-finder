import { BoxRenderable, InputRenderable, InputRenderableEvents, TextRenderable, type RenderContext, type Renderable } from "@opentui/core";
import type { SpotifyClient } from "../spotify";
import { ResultsPanel } from "./resultsPanel";

/** Exact, case-sensitive playlist name search. */
export class NameSearchTab {
  readonly container: BoxRenderable;
  private input: InputRenderable;
  private status: TextRenderable;
  private results: ResultsPanel;
  private spotify: SpotifyClient;
  private searchToken = 0;

  constructor(ctx: RenderContext, spotify: SpotifyClient, width: number, height: number) {
    this.spotify = spotify;

    this.container = new BoxRenderable(ctx, {
      id: "name-tab",
      width,
      height,
      flexDirection: "column",
      gap: 1,
      padding: 1,
    });

    const inputRow = new BoxRenderable(ctx, { id: "name-input-row", flexDirection: "row", gap: 1, height: 3 });
    inputRow.add(
      new TextRenderable(ctx, { id: "name-input-label", content: "Exact playlist name (case-sensitive):", fg: "#AAAAAA" }),
    );
    this.input = new InputRenderable(ctx, {
      id: "name-input",
      width: 50,
      placeholder: "My Summer Mix 2024",
      backgroundColor: "#1a1a1a",
      focusedBackgroundColor: "#2a2a2a",
      cursorColor: "#1DB954",
    });
    inputRow.add(this.input);

    this.status = new TextRenderable(ctx, { id: "name-status", content: "Type a name and press Enter.", fg: "#888888" });

    this.results = new ResultsPanel(ctx, {
      id: "name-results",
      width,
      height: height - 6,
      showConfidence: false,
    });

    this.container.add(inputRow);
    this.container.add(this.status);
    this.container.add(this.results.container);

    this.input.on(InputRenderableEvents.ENTER, (value: string) => {
      void this.runSearch(value);
    });
  }

  private async runSearch(query: string): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) {
      this.status.content = "Enter a playlist name first.";
      return;
    }

    const token = ++this.searchToken;
    this.status.content = `Searching for exact matches of "${trimmed}"...`;
    this.results.setHits([]);

    try {
      const hits = await this.spotify.searchExact(trimmed, (fetched) => {
        if (token !== this.searchToken) return;
        this.status.content = `Searching... scanned ${fetched} playlists so far.`;
      });
      if (token !== this.searchToken) return;

      this.results.setHits(hits);
      this.status.content =
        hits.length === 0
          ? `No exact case-sensitive match for "${trimmed}".`
          : `${hits.length} exact match${hits.length === 1 ? "" : "es"} for "${trimmed}". Tab to browse, Enter opens on Spotify.`;
    } catch (err) {
      if (token !== this.searchToken) return;
      this.status.content = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  get focusables(): Renderable[] {
    return [this.input, this.results.focusable];
  }

  focus(): void {
    this.input.focus();
  }
}
