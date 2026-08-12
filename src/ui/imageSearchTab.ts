import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type RenderContext,
  type Renderable,
  type KeyEvent,
} from "@opentui/core";
import type { SpotifyClient } from "../spotify";
import type { RankedPlaylistHit } from "../types";
import { CropTool } from "./cropTool";
import { ResultsPanel } from "./resultsPanel";
import { confidence, hashFromNativeImage, hashFromUrl, type ImageHash } from "../imageHash";

type Stage = "path" | "crop" | "query" | "searching" | "results";

/** Screenshot / cover-art based fuzzy search: crop a region, hash it, and rank
 * broad-search candidates by visual similarity to that hash. */
export class ImageSearchTab {
  readonly container: BoxRenderable;
  private pathPanel: BoxRenderable;
  private pathInput: InputRenderable;
  private queryPanel: BoxRenderable;
  private queryInput: InputRenderable;
  private status: TextRenderable;
  private cropTool: CropTool;
  private results: ResultsPanel;
  private spotify: SpotifyClient;
  private stage: Stage = "path";
  private targetHash: ImageHash | null = null;
  private searchToken = 0;
  private width: number;
  private height: number;

  constructor(ctx: RenderContext, spotify: SpotifyClient, width: number, height: number) {
    this.spotify = spotify;
    this.width = width;
    this.height = height;

    this.container = new BoxRenderable(ctx, {
      id: "image-tab",
      width,
      height,
      flexDirection: "column",
      gap: 1,
      padding: 1,
    });

    this.pathPanel = new BoxRenderable(ctx, { id: "image-path-panel", flexDirection: "row", gap: 1, height: 3 });
    this.pathPanel.add(new TextRenderable(ctx, { id: "image-path-label", content: "Screenshot/cover image path:", fg: "#AAAAAA" }));
    this.pathInput = new InputRenderable(ctx, {
      id: "image-path-input",
      width: 50,
      placeholder: "./screenshot.png",
      backgroundColor: "#1a1a1a",
      focusedBackgroundColor: "#2a2a2a",
      cursorColor: "#1DB954",
    });
    this.pathPanel.add(this.pathInput);

    this.queryPanel = new BoxRenderable(ctx, { id: "image-query-panel", flexDirection: "row", gap: 1, height: 3 });
    this.queryPanel.add(
      new TextRenderable(ctx, { id: "image-query-label", content: "Search keywords (broad, for candidates):", fg: "#AAAAAA" }),
    );
    this.queryInput = new InputRenderable(ctx, {
      id: "image-query-input",
      width: 50,
      placeholder: "chill lofi beats",
      backgroundColor: "#1a1a1a",
      focusedBackgroundColor: "#2a2a2a",
      cursorColor: "#1DB954",
    });
    this.queryPanel.add(this.queryInput);
    this.queryPanel.visible = false;

    this.status = new TextRenderable(ctx, {
      id: "image-status",
      content: "Enter a path to an image (full cover, or a screenshot to crop).",
      fg: "#888888",
    });

    this.cropTool = new CropTool(ctx, { id: "image-crop", width, height: height - 6 });
    this.cropTool.container.visible = false;

    this.results = new ResultsPanel(ctx, { id: "image-results", width, height: height - 6, showConfidence: true });

    this.container.add(this.pathPanel);
    this.container.add(this.queryPanel);
    this.container.add(this.status);
    this.container.add(this.cropTool.container);
    this.container.add(this.results.container);

    this.pathInput.on(InputRenderableEvents.ENTER, (value: string) => {
      void this.handlePathSubmit(value);
    });
    this.queryInput.on(InputRenderableEvents.ENTER, (value: string) => {
      void this.handleQuerySubmit(value);
    });
  }

  private async handlePathSubmit(rawPath: string): Promise<void> {
    const path = rawPath.trim();
    if (!path) {
      this.status.content = "Enter a file path first.";
      return;
    }

    this.status.content = `Loading ${path}...`;
    try {
      const { width, height } = await this.cropTool.loadSource(path);
      this.status.content = `Loaded ${width}x${height}px. Crop the cover art, then press Enter.`;
      this.stage = "crop";
      this.cropTool.container.visible = true;
      this.results.setHits([]);
    } catch (err) {
      this.status.content = `Could not load image: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private confirmCrop(): void {
    const cropped = this.cropTool.extract();
    try {
      this.targetHash = hashFromNativeImage(cropped);
    } finally {
      cropped.dispose();
    }
    this.stage = "query";
    this.cropTool.container.visible = false;
    this.queryPanel.visible = true;
    this.status.content = "Crop captured. Enter search keywords to gather candidate playlists.";
    this.queryInput.focus();
  }

  private cancelToPath(): void {
    this.stage = "path";
    this.cropTool.container.visible = false;
    this.queryPanel.visible = false;
    this.results.setHits([]);
    this.status.content = "Enter a path to an image (full cover, or a screenshot to crop).";
    this.pathInput.focus();
  }

  private async handleQuerySubmit(rawQuery: string): Promise<void> {
    const query = rawQuery.trim();
    if (!query || !this.targetHash) {
      this.status.content = "Enter search keywords first.";
      return;
    }

    const token = ++this.searchToken;
    this.stage = "searching";
    this.status.content = `Gathering candidates for "${query}"...`;
    this.results.setHits([]);

    try {
      const candidates = await this.spotify.searchBroad(query, 100, (fetched) => {
        if (token !== this.searchToken) return;
        this.status.content = `Gathering candidates... ${fetched} found so far.`;
      });
      if (token !== this.searchToken) return;

      if (candidates.length === 0) {
        this.status.content = `No playlists found for "${query}".`;
        this.stage = "results";
        return;
      }

      const ranked: RankedPlaylistHit[] = [];
      for (let i = 0; i < candidates.length; i++) {
        if (token !== this.searchToken) return;
        this.status.content = `Comparing cover art... ${i + 1}/${candidates.length}`;

        const hit = candidates[i]!;
        let coverUrl = hit.images[0]?.url;
        if (!coverUrl) coverUrl = (await this.spotify.fetchCoverUrl(hit.id)) ?? undefined;
        if (!coverUrl) {
          ranked.push({ ...hit, confidence: 0 });
          continue;
        }

        const candidateHash = await hashFromUrl(coverUrl);
        const score = candidateHash === null ? 0 : confidence(this.targetHash, candidateHash);
        ranked.push({ ...hit, confidence: score });
      }
      if (token !== this.searchToken) return;

      ranked.sort((a, b) => b.confidence - a.confidence);
      this.results.setHits(ranked);
      this.stage = "results";
      this.status.content = `${ranked.length} candidate${ranked.length === 1 ? "" : "s"} ranked by cover-art similarity for "${query}".`;
    } catch (err) {
      if (token !== this.searchToken) return;
      this.status.content = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      this.stage = "results";
    }
  }

  /** Consumes crop-mode navigation keys before generic Tab/focus cycling sees them. */
  handleKey(key: KeyEvent): boolean {
    if (this.stage === "crop") {
      if (key.name === "return") {
        this.confirmCrop();
        return true;
      }
      if (key.name === "escape") {
        this.cancelToPath();
        return true;
      }
      return this.cropTool.handleKey(key);
    }
    if (key.name === "escape" && (this.stage === "query" || this.stage === "results")) {
      this.cancelToPath();
      return true;
    }
    return false;
  }

  get focusables(): Renderable[] {
    return [this.pathInput, this.queryInput, this.results.focusable];
  }

  focus(): void {
    if (this.stage === "path") this.pathInput.focus();
    else if (this.stage === "query") this.queryInput.focus();
    else if (this.stage === "results") this.results.focus();
  }
}
