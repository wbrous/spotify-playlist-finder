import {
  BoxRenderable,
  ImageRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type RenderContext,
  type SelectOption,
} from "@opentui/core";
import type { PlaylistHit, RankedPlaylistHit } from "../types";

function describeHit(hit: PlaylistHit | RankedPlaylistHit, showConfidence: boolean): string {
  const owner = `by ${hit.ownerName}`;
  const tracks = `${hit.tracksTotal} track${hit.tracksTotal === 1 ? "" : "s"}`;
  const parts = [owner, tracks];
  if (showConfidence && "confidence" in hit) {
    parts.unshift(`${Math.round(hit.confidence * 100)}% match`);
  }
  return parts.join("  •  ");
}

function detailText(hit: PlaylistHit | RankedPlaylistHit, showConfidence: boolean): string {
  const lines = [
    hit.name,
    `Owner: ${hit.ownerName}`,
    `Tracks: ${hit.tracksTotal}`,
    `Visibility: ${hit.public === null ? "unknown" : hit.public ? "public" : "private"}`,
    `URL: ${hit.url}`,
  ];
  if (showConfidence && "confidence" in hit) {
    lines.splice(1, 0, `Confidence: ${Math.round(hit.confidence * 100)}%`);
  }
  if (hit.description) lines.push("", hit.description);
  return lines.join("\n");
}

/** Renders a scrollable playlist list next to a live cover-art + detail preview. */
export class ResultsPanel {
  readonly container: BoxRenderable;
  private list: SelectRenderable;
  private previewImage: ImageRenderable;
  private previewText: TextRenderable;
  private emptyText: TextRenderable;
  private hits: (PlaylistHit | RankedPlaylistHit)[] = [];
  private showConfidence: boolean;

  constructor(ctx: RenderContext, opts: { id: string; width: number; height: number; showConfidence: boolean }) {
    this.showConfidence = opts.showConfidence;

    this.container = new BoxRenderable(ctx, {
      id: `${opts.id}-container`,
      width: opts.width,
      height: opts.height,
      flexDirection: "row",
      gap: 1,
    });

    this.list = new SelectRenderable(ctx, {
      id: `${opts.id}-list`,
      width: Math.floor(opts.width * 0.55),
      height: opts.height,
      options: [],
      showDescription: true,
      wrapSelection: false,
    });

    const previewBox = new BoxRenderable(ctx, {
      id: `${opts.id}-preview`,
      flexGrow: 1,
      height: opts.height,
      borderStyle: "rounded",
      borderColor: "#666666",
      title: "Preview",
      padding: 1,
      flexDirection: "column",
      gap: 1,
    });

    this.previewImage = new ImageRenderable(ctx, {
      id: `${opts.id}-preview-image`,
      width: "100%",
      height: Math.max(6, Math.floor(opts.height * 0.55)),
      fit: "cover",
      protocol: "auto",
    });

    this.previewText = new TextRenderable(ctx, {
      id: `${opts.id}-preview-text`,
      content: "",
      fg: "#CCCCCC",
    });

    this.emptyText = new TextRenderable(ctx, {
      id: `${opts.id}-empty`,
      content: "No results yet.",
      fg: "#888888",
    });

    previewBox.add(this.previewImage);
    previewBox.add(this.previewText);

    this.container.add(this.list);
    this.container.add(previewBox);
    this.container.add(this.emptyText);
    this.emptyText.visible = false;

    this.list.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
      this.updatePreview(index);
    });
  }

  private updatePreview(index: number): void {
    const hit = this.hits[index];
    if (!hit) {
      this.previewImage.source = undefined;
      this.previewText.content = "";
      return;
    }
    const coverUrl = hit.images[0]?.url;
    this.previewImage.source = coverUrl;
    this.previewText.content = detailText(hit, this.showConfidence);
  }

  setHits(hits: (PlaylistHit | RankedPlaylistHit)[]): void {
    this.hits = hits;
    const options: SelectOption[] = hits.map((hit) => ({
      name: hit.name,
      description: describeHit(hit, this.showConfidence),
      value: hit.id,
    }));
    this.list.options = options;
    if (hits.length > 0) {
      this.list.setSelectedIndex(0);
      this.updatePreview(0);
      this.emptyText.visible = false;
      this.list.visible = true;
    } else {
      this.previewImage.source = undefined;
      this.previewText.content = "";
      this.emptyText.visible = true;
      this.list.visible = false;
    }
  }

  focus(): void {
    this.list.focus();
  }

  blur(): void {
    this.list.blur();
  }

  get focusable(): SelectRenderable {
    return this.list;
  }
}
