import { BoxRenderable, TextRenderable, createCliRenderer, t, fg, bold, type KeyEvent, type Renderable } from "@opentui/core";
import type { SpotifyClient } from "../spotify";
import { NameSearchTab } from "./nameSearchTab";
import { ImageSearchTab } from "./imageSearchTab";

interface TabController {
  container: BoxRenderable;
  focusables: Renderable[];
  focus(): void;
  handleKey?(key: KeyEvent): boolean;
}

const ACTIVE_COLOR = "#1DB954";
const INACTIVE_COLOR = "#666666";

export async function runApp(spotify: SpotifyClient): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 });

  const width = process.stdout.columns || 100;
  const termHeight = process.stdout.rows || 30;
  const contentHeight = Math.max(10, termHeight - 6);

  const root = new BoxRenderable(renderer, {
    id: "root",
    width,
    height: termHeight,
    flexDirection: "column",
    padding: 1,
  });


  const headerTitle = new TextRenderable(renderer, {
    id: "header-title",
    content: t`${bold(fg("#FFFFFF")("Spotify Playlist Finder"))}`,
  });

  const headerTabs = new TextRenderable(renderer, { id: "header-tabs", content: "" });

  const content = new BoxRenderable(renderer, { id: "content", width, height: contentHeight, flexDirection: "column" });

  const footer = new TextRenderable(renderer, {
    id: "footer",
    content: "Tab: cycle focus   F1: name search   F2: image search   Ctrl+C: quit",
    fg: "#555555",
  });

  root.add(headerTitle);
  root.add(headerTabs);
  root.add(content);
  root.add(footer);
  renderer.root.add(root);

  const nameTab = new NameSearchTab(renderer, spotify, width, contentHeight);
  const imageTab = new ImageSearchTab(renderer, spotify, width, contentHeight);
  content.add(nameTab.container);
  content.add(imageTab.container);
  imageTab.container.visible = false;

  const tabs: Record<"name" | "image", TabController> = { name: nameTab, image: imageTab };
  let active: "name" | "image" = "name";

  function renderHeaderTabs(): void {
    const nameLabel = active === "name" ? fg(ACTIVE_COLOR)(bold("[F1] Name Search")) : fg(INACTIVE_COLOR)("[F1] Name Search");
    const imageLabel = active === "image" ? fg(ACTIVE_COLOR)(bold("[F2] Image Search")) : fg(INACTIVE_COLOR)("[F2] Image Search");
    headerTabs.content = t`${nameLabel}   ${imageLabel}`;
  }

  function switchTab(target: "name" | "image"): void {
    if (target === active) return;
    tabs[active].container.visible = false;
    tabs[target].container.visible = true;
    active = target;
    renderHeaderTabs();
    tabs[active].focus();
  }

  function cycleFocus(forward: boolean): void {
    const list = tabs[active].focusables;
    if (list.length === 0) return;
    let idx = list.findIndex((r) => r.focused);
    if (idx === -1) idx = forward ? 0 : list.length - 1;
    else idx = forward ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length;
    list[idx]?.focus();
  }

  renderHeaderTabs();
  nameTab.focus();

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (tabs[active].handleKey?.(key)) return;

    if (key.name === "f1") {
      switchTab("name");
      return;
    }
    if (key.name === "f2") {
      switchTab("image");
      return;
    }
    if (key.name === "tab") {
      cycleFocus(!key.shift);
    }
  });
}
