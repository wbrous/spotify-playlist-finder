import { BoxRenderable, ImageRenderable, TextRenderable, NativeImage, type RenderContext, type KeyEvent } from "@opentui/core";

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SELECTION_CELLS = 2;

/**
 * Displays a full image stretched into a fixed cell grid with a keyboard-
 * driven selection rectangle. Because the image is rendered with `fit: "fill"`,
 * cell coordinates map linearly onto source pixel coordinates, so the
 * selection can be converted straight into a crop rect for `NativeImage.extract`.
 */
export class CropTool {
  readonly container: BoxRenderable;
  private image: ImageRenderable;
  private selection: BoxRenderable;
  private hint: TextRenderable;
  private boxW: number;
  private boxH: number;
  private selX = 0;
  private selY = 0;
  private selW = 0;
  private selH = 0;
  private sourceImage: NativeImage | null = null;

  constructor(ctx: RenderContext, opts: { id: string; width: number; height: number }) {
    this.boxW = opts.width;
    this.boxH = opts.height - 2; // leave a row for the hint line

    this.container = new BoxRenderable(ctx, {
      id: `${opts.id}-container`,
      width: opts.width,
      height: opts.height,
      flexDirection: "column",
    });

    const stage = new BoxRenderable(ctx, {
      id: `${opts.id}-stage`,
      width: this.boxW,
      height: this.boxH,
      position: "relative",
    });

    this.image = new ImageRenderable(ctx, {
      id: `${opts.id}-image`,
      width: this.boxW,
      height: this.boxH,
      fit: "fill",
      protocol: "auto",
      position: "absolute",
      left: 0,
      top: 0,
    });

    this.selection = new BoxRenderable(ctx, {
      id: `${opts.id}-selection`,
      position: "absolute",
      left: 0,
      top: 0,
      width: this.boxW,
      height: this.boxH,
      border: true,
      borderStyle: "heavy",
      borderColor: "#1DB954",
    });

    this.hint = new TextRenderable(ctx, {
      id: `${opts.id}-hint`,
      content: "Arrows: move   Shift+Arrows: resize   Enter: confirm crop   Esc: start over",
      fg: "#888888",
    });

    stage.add(this.image);
    stage.add(this.selection);
    this.container.add(stage);
    this.container.add(this.hint);
  }

  /** Loads a new source image and resets the selection to the full frame. */
  async loadSource(path: string): Promise<{ width: number; height: number }> {
    this.sourceImage?.dispose();
    this.sourceImage = await NativeImage.load(path);
    this.image.source = path;

    this.selX = 0;
    this.selY = 0;
    this.selW = this.boxW;
    this.selH = this.boxH;
    this.render();

    return { width: this.sourceImage.width, height: this.sourceImage.height };
  }

  /** Returns true if the key was consumed by the crop tool. */
  handleKey(key: KeyEvent): boolean {
    const step = 1;
    if (key.shift) {
      switch (key.name) {
        case "left":
          this.selW = Math.max(MIN_SELECTION_CELLS, this.selW - step);
          break;
        case "right":
          this.selW = Math.min(this.boxW - this.selX, this.selW + step);
          break;
        case "up":
          this.selH = Math.max(MIN_SELECTION_CELLS, this.selH - step);
          break;
        case "down":
          this.selH = Math.min(this.boxH - this.selY, this.selH + step);
          break;
        default:
          return false;
      }
      this.render();
      return true;
    }

    switch (key.name) {
      case "left":
        this.selX = Math.max(0, this.selX - step);
        break;
      case "right":
        this.selX = Math.min(this.boxW - this.selW, this.selX + step);
        break;
      case "up":
        this.selY = Math.max(0, this.selY - step);
        break;
      case "down":
        this.selY = Math.min(this.boxH - this.selH, this.selY + step);
        break;
      default:
        return false;
    }
    this.render();
    return true;
  }

  private render(): void {
    this.selection.left = this.selX;
    this.selection.top = this.selY;
    this.selection.width = this.selW;
    this.selection.height = this.selH;

    const image = this.sourceImage;
    const cropWidth = image ? Math.round((this.selW / this.boxW) * image.width) : 0;
    const cropHeight = image ? Math.round((this.selH / this.boxH) * image.height) : 0;
    this.hint.content = `Selection: ${cropWidth}x${cropHeight}px   Arrows: move   Shift+Arrows: resize   Enter: confirm   Esc: start over`;
  }

  /** Crops the loaded source to the current selection. Caller must dispose the result. */
  extract(): NativeImage {
    if (!this.sourceImage) throw new Error("No image loaded");
    const left = Math.min(this.sourceImage.width - 1, Math.round((this.selX / this.boxW) * this.sourceImage.width));
    const top = Math.min(this.sourceImage.height - 1, Math.round((this.selY / this.boxH) * this.sourceImage.height));
    const width = Math.max(1, Math.min(this.sourceImage.width - left, Math.round((this.selW / this.boxW) * this.sourceImage.width)));
    const height = Math.max(1, Math.min(this.sourceImage.height - top, Math.round((this.selH / this.boxH) * this.sourceImage.height)));
    return this.sourceImage.extract({ left, top, width, height });
  }

  dispose(): void {
    this.sourceImage?.dispose();
    this.sourceImage = null;
  }
}
