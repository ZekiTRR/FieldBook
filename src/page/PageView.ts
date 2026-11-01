import type { App } from "obsidian";
import type {
  ActiveTool,
  AudioElement,
  BrushKind,
  BrushSettings,
  DecorKind,
  DecorationElement,
  DrawingElement,
  ImageElement,
  LayerId,
  PageElement,
  PageMeta,
  PageData,
  ShapeElement,
  ShapeKind,
  Side,
  TextElement,
} from "../types";
import type { JournalManager } from "../core/JournalManager";
import type { UndoRedoManager } from "../core/History";
import type { AudioManager } from "../audio/AudioManager";
import { InkRenderer } from "../drawing/InkRenderer";
import { smoothPoint, simplifyStroke, type RawPoint } from "../drawing/Smoothing";
import { assistStroke } from "../drawing/ShapeAssist";
import {
  createAudioElement,
  createDecorationElement,
  createDrawingElement,
  createImageElement,
  createShapeElement,
  createTapeForImage,
  createTextElement,
} from "../elements/Factory";
import {
  applyElementFrame,
  applyVoiceLevels,
  applyVoiceProgress,
  createElementNode,
} from "../elements/Renderer";
import { VOICE_HEIGHT, VOICE_MAX_WIDTH, VOICE_MIN_WIDTH, voiceParts } from "../elements/VoiceWave";
import {
  centerOf,
  clamp,
  deepClone,
  degToRad,
  elementCorners,
  hitTestElementDeep,
  hitTestDrawing,
  nextZ,
  normalizeRect,
  radToDeg,
  rotatePoint,
  snapValue,
  uid,
  unionBounds,
  type Bounds,
} from "../utils";

export interface ShapeStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  dashed: boolean;
  sides: number;
}

export interface ToolState {
  tool: ActiveTool;
  brush: BrushKind | "eraser";
  brushSettings: BrushSettings;
  eraserSize: number;
  shape: ShapeKind;
  decor: DecorKind;
  shapeStyle: ShapeStyle;
}

export interface PageHost {
  app: App;
  store: JournalManager;
  history: UndoRedoManager;
  audio: AudioManager;
  getTool(): ToolState;
  isDarkTheme(): boolean;
  resolveColor(value: string): string;
  resourcePath(path: string): string;
  attachmentExists(path: string): boolean;
  afterToolUse(): void;
  activatePage(page: PageView): void;
  onSelectionChange(page: PageView | null): void;
  onPageEdited(page: PageView): void;
  onPageContentChanged(pageId: string): void;
  openElementMenu(event: MouseEvent, page: PageView, element: PageElement): void;
  openPageMenu(event: MouseEvent, page: PageView): void;
  openCrop(page: PageView, image: ImageElement): void;
  openLink(link: string): void;
  notify(message: string): void;
  navigateToPage(pageId: string): void;
  beginVoiceNote(page: PageView, point: { x: number; y: number }): void;
  stopVoicePlacement(): void;
  isVoicePlacement(elementId: string): boolean;
  toggleVoiceNote(page: PageView, element: AudioElement, ratio: number): void;
  seekVoiceNote(page: PageView, element: AudioElement, ratio: number): void;
}

export interface SelectionInfo {
  count: number;
  kind: "none" | "mixed" | PageElement["type"];
  text?: TextElement;
  image?: ImageElement;
  shape?: ShapeElement;
  decoration?: DecorationElement;
  audio?: AudioElement;
  bounds: Bounds | null;
}

export interface PageViewOptions {
  pageId: string | null;
  side: Side;
  number: number;
  staticMode?: boolean;
}

type HandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

interface HandleDescriptor {
  kind: HandleKind;
  x: number;
  y: number;
  rotation: number;
}

interface GestureSnapshot {
  elements: PageElement[];
  targets: PageElement[];
  start: { x: number; y: number };
  groupCenter: { x: number; y: number };
  startBounds: Bounds;
  single: boolean;
  moved: boolean;
  beforeById: Map<string, PageElement>;
}

interface TextEditState {
  id: string;
  before: TextElement;
  isNew: boolean;
  node: HTMLElement;
  body: HTMLElement;
  cleanup: () => void;
}

interface ActiveStroke {
  pointerId: number;
  points: RawPoint[];
  lastRaw: RawPoint | null;
  style: { brush: BrushKind; color: string; size: number; opacity: number; pressureEnabled: boolean; assist: boolean };
  frame: number | null;
}

const MIN_ELEMENT_SIZE = 12;
const SNAP_DISTANCE = 7;

export class PageView {
  readonly root: HTMLElement;
  readonly host: PageHost;
  readonly pageId: string | null;
  readonly side: Side;
  readonly staticMode: boolean;

  page: PageData | null = null;
  meta: PageMeta | null = null;
  number: number;
  scale = 1;
  destroyed = false;

  private contentEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private outlineEl!: HTMLElement;
  private handlesEl!: HTMLElement;
  private guidesEl!: HTMLElement;
  private marqueeEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private numberEl!: HTMLElement;
  private layersEl: HTMLElement | null = null;

  private ink = new InkRenderer();
  private liveCanvas: HTMLCanvasElement | null = null;
  private layerContainers = new Map<LayerId, HTMLElement>();
  private layerCanvases = new Map<LayerId, HTMLCanvasElement>();
  private elementNodes = new Map<string, HTMLElement>();

  selectedIds = new Set<string>();
  private editing: TextEditState | null = null;
  private activeStroke: ActiveStroke | null = null;
  private eraserState: { pointerId: number; removed: PageElement[]; layers: Set<LayerId> } | null = null;
  private gestureCleanup: (() => void) | null = null;
  private inkFrame: number | null = null;
  private liveEditBefore: PageElement[] | null = null;

  constructor(host: PageHost, options: PageViewOptions) {
    this.host = host;
    this.pageId = options.pageId;
    this.side = options.side;
    this.number = options.number;
    this.staticMode = options.staticMode ?? false;
    this.root = document.createElement("div");
    this.root.className = `fb-page fb-page--${options.side}`;
    if (this.staticMode) this.root.classList.add("is-static");
    this.buildShell();
  }

  async mount(parent: HTMLElement, scale: number): Promise<void> {
    parent.appendChild(this.root);
    this.setScale(scale);
    if (!this.pageId) {
      this.root.classList.add("is-blank");
      this.updateNumber();
      return;
    }
    const page = await this.host.store.loadPage(this.pageId);
    if (this.destroyed) return;
    if (!page) {
      this.root.classList.add("is-blank");
      this.updateNumber();
      return;
    }
    this.page = page;
    this.meta = this.host.store.getPageMeta(this.pageId) ?? null;
    this.render();
  }

  async whenPainted(): Promise<void> {
    try {
      await document.fonts?.ready;
    } catch {
      /* fonts are optional */
    }
    const images = Array.from(this.root.querySelectorAll<HTMLImageElement>("img"));
    await Promise.all(
      images.map(async (image) => {
        if (image.complete && image.naturalWidth > 0) {
          try {
            await image.decode();
          } catch {
            /* decode can reject for already-painted images */
          }
          return;
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            image.removeEventListener("load", done);
            image.removeEventListener("error", done);
            resolve();
          };
          image.addEventListener("load", done);
          image.addEventListener("error", done);
        });
      }),
    );
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
  }

  private buildShell(): void {
    const grain = document.createElement("div");
    grain.className = "fb-page__grain";
    const wash = document.createElement("div");
    wash.className = "fb-page__wash";
    const pattern = document.createElement("div");
    pattern.className = "fb-page__pattern";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "fb-page__title";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "fb-page__content";
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "fb-page__overlay";
    this.outlineEl = document.createElement("div");
    this.outlineEl.className = "fb-overlay-outline";
    this.handlesEl = document.createElement("div");
    this.handlesEl.className = "fb-overlay-handles";
    this.guidesEl = document.createElement("div");
    this.guidesEl.className = "fb-overlay-guides";
    this.marqueeEl = document.createElement("div");
    this.marqueeEl.className = "fb-marquee";
    this.overlayEl.append(this.outlineEl, this.handlesEl, this.guidesEl, this.marqueeEl);
    this.numberEl = document.createElement("div");
    this.numberEl.className = "fb-page__number";
    const gutter = document.createElement("div");
    gutter.className = "fb-page__gutter";
    const edge = document.createElement("div");
    edge.className = "fb-page__edge";
    this.root.append(grain, wash, pattern, this.titleEl, this.contentEl, this.overlayEl, this.numberEl, gutter, edge);
    if (!this.staticMode) this.bindPageEvents();
  }

  private bindPageEvents(): void {
    this.root.addEventListener("pointerdown", this.onPagePointerDown);
    this.root.addEventListener("pointermove", this.onPageHover);
    this.root.addEventListener("pointerleave", this.onPageLeave);
    this.root.addEventListener("dblclick", this.onDoubleClick);
    this.root.addEventListener("contextmenu", this.onContextMenu);
  }

  setScale(scale: number): void {
    this.scale = Math.max(0.05, scale);
    this.contentEl.style.width = `${this.host.store.getSettings().pageWidth}px`;
    this.contentEl.style.height = `${this.host.store.getSettings().pageHeight}px`;
    this.contentEl.style.transform = `scale(${this.scale})`;
    this.ink.resize(this.scale, window.devicePixelRatio || 1);
    if (this.page) this.scheduleInkRedraw();
    this.updateSelectionOverlay();
  }

  setNumber(value: number): void {
    this.number = value;
    this.updateNumber();
  }

  private updateNumber(): void {
    const show = this.host.store.getSettings().showPageNumbers && this.number > 0;
    this.numberEl.textContent = show ? String(this.number) : "";
  }

  refreshMeta(): void {
    if (!this.pageId) return;
    const meta = this.host.store.getPageMeta(this.pageId);
    if (!meta) return;
    this.meta = meta;
    if (!this.page) return;
    this.page.title = meta.title;
    this.page.background = meta.background;
    this.titleEl.textContent = meta.kind === "contents" ? "" : meta.title;
    this.root.dataset.background = meta.background;
    this.updateNumber();
    if (this.selectedIds.size) this.updateSelectionOverlay();
  }

  private render(): void {
    const page = this.page;
    if (!page) return;
    this.root.dataset.background = page.background;
    this.root.classList.toggle("is-contents", page.kind === "contents");
    this.titleEl.textContent = page.kind === "contents" ? "" : this.meta?.title ?? page.title;
    this.updateNumber();
    this.contentEl.replaceChildren();
    this.elementNodes.clear();
    this.layerContainers.clear();
    this.layerCanvases.clear();
    this.ink.destroy();
    this.ink = new InkRenderer();
    this.ink.setContext({
      pageWidth: this.host.store.getSettings().pageWidth,
      pageHeight: this.host.store.getSettings().pageHeight,
      scale: this.scale,
      dpr: window.devicePixelRatio || 1,
      darkPaper: this.host.isDarkTheme(),
      resolveColor: (value) => this.host.resolveColor(value),
    });

    if (page.kind === "contents") {
      this.layersEl = null;
      this.contentEl.appendChild(this.renderToc());
      this.updateSelectionOverlay();
      return;
    }

    this.layersEl = document.createElement("div");
    this.layersEl.className = "fb-layers";
    this.contentEl.appendChild(this.layersEl);

    page.layers.forEach((layer, index) => {
      const container = document.createElement("div");
      container.className = "fb-layer";
      container.dataset.layer = layer.id;
      container.style.zIndex = String(index);
      if (!layer.visible) container.classList.add("is-hidden");
      if (layer.locked) container.classList.add("is-locked");
      this.layerContainers.set(layer.id, container);
      this.layersEl?.appendChild(container);
    });

    const sorted = page.elements.slice().sort((a, b) => a.z - b.z);
    for (const el of sorted) {
      const container = this.layerContainers.get(el.layer);
      if (!container) continue;
      if (el.type === "drawing") continue;
      const node = createElementNode(
        el,
        (path) => this.host.resourcePath(path),
        (path) => this.host.attachmentExists(path),
      );
      this.elementNodes.set(el.id, node);
      container.appendChild(node);
    }

    const drawingsByLayer = new Map<LayerId, DrawingElement[]>();
    for (const el of page.elements) {
      if (el.type !== "drawing") continue;
      const list = drawingsByLayer.get(el.layer) ?? [];
      list.push(el);
      drawingsByLayer.set(el.layer, list);
    }
    for (const [layerId, elements] of drawingsByLayer) {
      this.ensureLayerCanvas(layerId);
      if (elements.length === 0) continue;
    }
    this.ink.redrawAll(
      page.elements.filter((el): el is DrawingElement => el.type === "drawing"),
    );

    if (!this.staticMode) {
      this.liveCanvas = document.createElement("canvas");
      this.liveCanvas.className = "fb-live-ink";
      this.contentEl.appendChild(this.liveCanvas);
      this.ink.setLiveCanvas(this.liveCanvas);
    }

    if (!this.staticMode && page.elements.length === 0) {
      this.contentEl.appendChild(this.renderEmptyHint());
    }

    this.selectedIds = new Set(
      Array.from(this.selectedIds).filter((id) => page.elements.some((el) => el.id === id)),
    );
    this.updateSelectionOverlay();
  }

  private renderEmptyHint(): HTMLElement {
    const hint = document.createElement("div");
    hint.className = "fb-page__empty";
    const ornament = document.createElement("div");
    ornament.className = "fb-page__empty-ornament";
    ornament.textContent = "\u2736";
    const title = document.createElement("div");
    title.className = "fb-page__empty-title";
    title.textContent = "A blank page";
    const text = document.createElement("div");
    text.className = "fb-page__empty-text";
    text.textContent = "Write, sketch, tape in a photograph. Use the tools on the left.";
    hint.append(ornament, title, text);
    return hint;
  }

  private renderToc(): HTMLElement {
    const toc = document.createElement("div");
    toc.className = "fb-toc";
    const eyebrow = document.createElement("div");
    eyebrow.className = "fb-toc__eyebrow";
    eyebrow.textContent = "Field Notes";
    const title = document.createElement("h1");
    title.className = "fb-toc__title";
    title.textContent = this.host.store.journal.title;
    const sub = document.createElement("div");
    sub.className = "fb-toc__subtitle";
    sub.textContent = "Contents";
    const rule = document.createElement("div");
    rule.className = "fb-toc__rule";
    toc.append(eyebrow, title, sub, rule);

    const entries = this.host.store.getToc();
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "fb-toc__empty";
      empty.textContent = "The notebook is still empty. Add a page to begin.";
      toc.appendChild(empty);
      return toc;
    }

    const cols = document.createElement("div");
    cols.className = "fb-toc__columns";
    const byTab = new Map<string, { name: string; entries: typeof entries }>();
    for (const entry of entries) {
      const group = byTab.get(entry.tabId) ?? { name: entry.tabName, entries: [] };
      group.entries.push(entry);
      byTab.set(entry.tabId, group);
    }
    for (const group of byTab.values()) {
      const block = document.createElement("div");
      block.className = "fb-toc__group";
      const heading = document.createElement("div");
      heading.className = "fb-toc__tab";
      heading.textContent = group.name;
      block.appendChild(heading);
      for (const entry of group.entries) {
        const row = document.createElement("button");
        row.className = "fb-toc__row";
        row.type = "button";
        const label = document.createElement("span");
        label.className = "fb-toc__label";
        label.textContent = entry.title;
        const leader = document.createElement("span");
        leader.className = "fb-toc__leader";
        const number = document.createElement("span");
        number.className = "fb-toc__number";
        number.textContent = String(entry.number);
        row.append(label, leader, number);
        row.addEventListener("click", (event) => {
          event.stopPropagation();
          this.host.navigateToPage(entry.pageId);
        });
        if (this.staticMode) row.disabled = true;
        block.appendChild(row);
      }
      cols.appendChild(block);
    }
    toc.appendChild(cols);
    const epigraph = document.createElement("div");
    epigraph.className = "fb-toc__epigraph";
    epigraph.textContent = "Write down what you saw, not what you feared.";
    toc.appendChild(epigraph);
    const foot = document.createElement("div");
    foot.className = "fb-toc__foot";
    const created = new Date(this.host.store.journal.createdAt);
    const dateLabel = Number.isNaN(created.getTime())
      ? ""
      : created.toLocaleDateString("en", { month: "long", year: "numeric" });
    foot.textContent = `${this.host.store.getPageCount()} pages${dateLabel ? ` \u00b7 begun ${dateLabel}` : ""}`;
    toc.appendChild(foot);
    return toc;
  }

  private ensureLayerCanvas(layerId: LayerId): HTMLCanvasElement | null {
    const existing = this.layerCanvases.get(layerId);
    if (existing) return existing;
    const container = this.layerContainers.get(layerId);
    if (!container) return null;
    const canvas = document.createElement("canvas");
    canvas.className = "fb-ink-canvas";
    canvas.dataset.layer = layerId;
    container.prepend(canvas);
    this.layerCanvases.set(layerId, canvas);
    this.ink.setLayerCanvas(layerId, canvas);
    return canvas;
  }

  private scheduleInkRedraw(): void {
    if (this.inkFrame !== null) return;
    this.inkFrame = window.requestAnimationFrame(() => {
      this.inkFrame = null;
      if (!this.page || this.destroyed) return;
      this.ink.redrawAll(
        this.page.elements.filter((el): el is DrawingElement => el.type === "drawing"),
      );
    });
  }

  // ---------------------------------------------------------------------
  // Hit testing and selection
  // ---------------------------------------------------------------------

  private layerState(id: LayerId) {
    return this.page?.layers.find((layer) => layer.id === id) ?? null;
  }

  private isLayerInteractive(id: LayerId): boolean {
    const layer = this.layerState(id);
    return !!layer && layer.visible && !layer.locked;
  }

  private hitTest(point: { x: number; y: number }): PageElement | null {
    if (!this.page) return null;
    const layers = this.page.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.locked) continue;
      const candidates = this.page.elements
        .filter((el) => el.layer === layer.id && !el.locked)
        .sort((a, b) => b.z - a.z);
      for (const el of candidates) {
        if (hitTestElementDeep(el, point)) return el;
      }
    }
    return null;
  }

  private groupMembers(el: PageElement): PageElement[] {
    if (!el.groupId || !this.page) return [el];
    return this.page.elements.filter((candidate) => candidate.groupId === el.groupId);
  }

  getSelectedElements(): PageElement[] {
    if (!this.page) return [];
    return this.page.elements.filter((el) => this.selectedIds.has(el.id));
  }

  hasSelection(): boolean {
    return this.selectedIds.size > 0;
  }

  isEditing(): boolean {
    return this.editing !== null;
  }

  getSelectionInfo(): SelectionInfo {
    const elements = this.getSelectedElements();
    if (!elements.length) return { count: 0, kind: "none", bounds: null };
    const first = elements[0];
    const sameKind = elements.every((el) => el.type === first.type);
    const kind = sameKind ? first.type : "mixed";
    const info: SelectionInfo = {
      count: elements.length,
      kind,
      bounds: unionBounds(elements),
    };
    if (sameKind && first.type === "text") info.text = deepClone(first);
    if (sameKind && first.type === "image") info.image = deepClone(first);
    if (sameKind && first.type === "shape") info.shape = deepClone(first);
    if (sameKind && first.type === "decoration") info.decoration = deepClone(first);
    if (sameKind && first.type === "audio") info.audio = deepClone(first);
    return info;
  }

  private setSelection(ids: Iterable<string>): void {
    this.commitLiveEdit("Adjust");
    this.selectedIds = new Set(ids);
    this.updateSelectionOverlay();
    this.host.onSelectionChange(this);
  }

  clearSelection(notify = true): void {
    this.commitLiveEdit("Adjust");
    if (!this.selectedIds.size) return;
    this.selectedIds.clear();
    this.updateSelectionOverlay();
    if (notify) this.host.onSelectionChange(this);
  }

  beginLiveEdit(): void {
    if (this.liveEditBefore) return;
    if (this.editing) this.finishEditing(true);
    this.liveEditBefore = this.getSelectedElements().map((el) => deepClone(el));
  }

  applyLivePatch(mutator: (el: PageElement) => void): void {
    if (!this.liveEditBefore) this.beginLiveEdit();
    for (const el of this.getSelectedElements()) mutator(el);
    this.markDirty();
    this.render();
  }

  commitLiveEdit(label: string): void {
    const before = this.liveEditBefore;
    this.liveEditBefore = null;
    if (!before || !this.page || !before.length) return;
    const after = this.getSelectedElements().map((el) => deepClone(el));
    if (!after.length) return;
    this.pushUpdateHistory(before, after, label);
    this.markDirty();
    this.host.onSelectionChange(this);
    this.host.onPageEdited(this);
  }

  selectElement(el: PageElement, additive = false): void {
    const group = this.groupMembers(el).map((member) => member.id);
    if (additive) {
      const allSelected = group.every((id) => this.selectedIds.has(id));
      if (allSelected) group.forEach((id) => this.selectedIds.delete(id));
      else group.forEach((id) => this.selectedIds.add(id));
    } else if (!group.every((id) => this.selectedIds.has(id)) || this.selectedIds.size !== group.length) {
      this.selectedIds = new Set(group);
    }
    this.updateSelectionOverlay();
    this.host.onSelectionChange(this);
  }

  selectAll(): void {
    if (!this.page || this.page.kind === "contents") return;
    const ids = this.page.elements
      .filter((el) => {
        const layer = this.layerState(el.layer);
        return layer?.visible && !layer.locked && !el.locked;
      })
      .map((el) => el.id);
    this.setSelection(ids);
  }

  private expandWithAttachments(elements: PageElement[]): PageElement[] {
    if (!this.page) return elements;
    const ids = new Set(elements.map((el) => el.id));
    const extra = this.page.elements.filter(
      (el) => el.type === "decoration" && el.attachTo && ids.has(el.attachTo),
    );
    for (const el of extra) ids.add(el.id);
    return this.page.elements.filter((el) => ids.has(el.id));
  }

  // ---------------------------------------------------------------------
  // Selection overlay and handles
  // ---------------------------------------------------------------------

  private updateSelectionOverlay(): void {
    this.outlineEl.replaceChildren();
    this.handlesEl.replaceChildren();
    if (this.staticMode || !this.page || this.page.kind === "contents") return;
    if (this.editing) return;
    const elements = this.getSelectedElements();
    if (!elements.length) return;
    const visible = elements.filter((el) => this.layerState(el.layer)?.visible);
    if (!visible.length) return;

    const single = elements.length === 1 ? elements[0] : null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.classList.add("fb-outline-svg");
    const toScreen = (x: number, y: number) => ({ x: x * this.scale, y: y * this.scale });
    let descriptors: HandleDescriptor[] = [];
    let rotation = 0;

    if (single) {
      const corners = elementCorners(single).map((p) => toScreen(p.x, p.y));
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.setAttribute("points", corners.map((p) => `${p.x},${p.y}`).join(" "));
      polygon.classList.add("fb-outline-polygon");
      if (single.pinned || single.locked) polygon.classList.add("is-fixed");
      svg.appendChild(polygon);
      const [nw, ne, se, sw] = corners;
      const topMid = midpoint(nw, ne);
      const bottomMid = midpoint(sw, se);
      const leftMid = midpoint(nw, sw);
      const rightMid = midpoint(ne, se);
      const center = centerScreen(corners);
      const dir = normalize({ x: topMid.x - center.x, y: topMid.y - center.y });
      const rotatePointPos = { x: topMid.x + dir.x * 28, y: topMid.y + dir.y * 28 };
      const canTransform = !single.pinned && !single.locked;
      descriptors = canTransform
        ? [
            { kind: "nw", x: nw.x, y: nw.y, rotation: single.rotation },
            { kind: "n", x: topMid.x, y: topMid.y, rotation: single.rotation },
            { kind: "ne", x: ne.x, y: ne.y, rotation: single.rotation },
            { kind: "e", x: rightMid.x, y: rightMid.y, rotation: single.rotation },
            { kind: "se", x: se.x, y: se.y, rotation: single.rotation },
            { kind: "s", x: bottomMid.x, y: bottomMid.y, rotation: single.rotation },
            { kind: "sw", x: sw.x, y: sw.y, rotation: single.rotation },
            { kind: "w", x: leftMid.x, y: leftMid.y, rotation: single.rotation },
            { kind: "rotate", x: rotatePointPos.x, y: rotatePointPos.y, rotation: single.rotation },
          ]
        : [];
      if (single.type === "audio" && canTransform) {
        // The strip keeps its height, so only the horizontal edges and the rotate knob are useful.
        descriptors = descriptors.filter(
          (descriptor) =>
            descriptor.kind === "e" || descriptor.kind === "w" || descriptor.kind === "rotate",
        );
      }
      if (canTransform) {
        const stem = document.createElementNS("http://www.w3.org/2000/svg", "line");
        stem.setAttribute("x1", String(topMid.x));
        stem.setAttribute("y1", String(topMid.y));
        stem.setAttribute("x2", String(rotatePointPos.x));
        stem.setAttribute("y2", String(rotatePointPos.y));
        stem.classList.add("fb-outline-stem");
        svg.appendChild(stem);
      }
      rotation = single.rotation;
    } else {
      const bounds = unionBounds(visible);
      const x = bounds.x * this.scale;
      const y = bounds.y * this.scale;
      const w = bounds.w * this.scale;
      const h = bounds.h * this.scale;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(h));
      rect.classList.add("fb-outline-polygon");
      svg.appendChild(rect);
      const canTransform = visible.some(
        (el) => !el.pinned && !el.locked && this.isLayerInteractive(el.layer),
      );
      descriptors = canTransform
        ? [
            { kind: "nw", x, y, rotation: 0 },
            { kind: "n", x: x + w / 2, y, rotation: 0 },
            { kind: "ne", x: x + w, y, rotation: 0 },
            { kind: "e", x: x + w, y: y + h / 2, rotation: 0 },
            { kind: "se", x: x + w, y: y + h, rotation: 0 },
            { kind: "s", x: x + w / 2, y: y + h, rotation: 0 },
            { kind: "sw", x, y: y + h, rotation: 0 },
            { kind: "w", x, y: y + h / 2, rotation: 0 },
            { kind: "rotate", x: x + w / 2, y: y - 28, rotation: 0 },
          ]
        : [];
    }

    this.outlineEl.appendChild(svg);
    for (const descriptor of descriptors) {
      const handle = document.createElement("div");
      handle.className = `fb-handle fb-handle--${descriptor.kind}`;
      handle.dataset.handle = descriptor.kind;
      handle.style.left = `${descriptor.x}px`;
      handle.style.top = `${descriptor.y}px`;
      handle.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.beginTransformGesture(descriptor.kind, event);
      });
      this.handlesEl.appendChild(handle);
    }
  }

  private updateGuides(guides: { axis: "x" | "y"; value: number }[]): void {
    this.guidesEl.replaceChildren();
    for (const guide of guides) {
      const line = document.createElement("div");
      line.className = `fb-guide fb-guide--${guide.axis}`;
      if (guide.axis === "x") line.style.left = `${guide.value * this.scale}px`;
      else line.style.top = `${guide.value * this.scale}px`;
      this.guidesEl.appendChild(line);
    }
  }

  private clearGuides(): void {
    this.guidesEl.replaceChildren();
  }

  // ---------------------------------------------------------------------
  // Page pointer events
  // ---------------------------------------------------------------------

  private onPagePointerDown = (event: PointerEvent): void => {
    if (this.staticMode || !this.page) return;
    if (event.button === 2) return;
    this.host.activatePage(this);
    if (this.editing) {
      const target = event.target as Node | null;
      if (this.editing.body.contains(target)) return;
      if (!this.editing.node.contains(target)) this.finishEditing(true);
    }
    if (event.button !== 0) return;
    const point = this.pagePoint(event);
    const tool = this.host.getTool();
    if (this.page.kind === "contents") {
      return;
    }
    this.host.audio.unlock();

    if (tool.tool === "draw") {
      this.clearSelection();
      if (tool.brush === "eraser") this.beginErase(event, point, tool);
      else this.beginStroke(event, point, tool);
      return;
    }
    if (tool.tool === "text") {
      event.preventDefault();
      this.createTextAt(point);
      return;
    }
    if (tool.tool === "shape") {
      this.beginShapeCreation(point, tool);
      return;
    }
    if (tool.tool === "decorate") {
      this.insertDecorationAt(tool.decor, point);
      this.host.afterToolUse();
      return;
    }
    if (tool.tool === "audio") {
      this.host.beginVoiceNote(this, point);
      return;
    }

    const hit = this.hitTest(point);
    if (hit) {
      this.selectElement(hit, event.shiftKey);
      if (event.shiftKey) {
        if (!this.selectedIds.has(hit.id)) return;
      }
      if (hit.type === "audio") {
        const zone = this.voiceZone(hit, point);
        if (zone === "play") {
          if (this.host.isVoicePlacement(hit.id)) this.host.stopVoicePlacement();
          else this.host.toggleVoiceNote(this, hit, this.voiceRatioAt(hit, point));
          return;
        }
        if (zone === "wave") {
          const ratio = this.voiceRatioAt(hit, point);
          if (hit.pinned) {
            this.host.seekVoiceNote(this, hit, ratio);
            return;
          }
          if (!hit.locked) this.beginMove(event, point, () => this.host.seekVoiceNote(this, hit, ratio));
          return;
        }
      }
      if (!hit.pinned) {
        this.beginMove(event, point);
      }
    } else {
      if (!event.shiftKey) this.clearSelection();
      this.beginMarquee(event, point, event.shiftKey);
    }
  };

  private onPageHover = (event: PointerEvent): void => {
    if (this.staticMode || !this.page || this.page.kind === "contents") return;
    if (this.activeStroke || this.eraserState) return;
    const tool = this.host.getTool();
    const point = this.pagePoint(event);
    if (this.isEraserActive(tool)) {
      this.ink.drawEraser(point.x, point.y, tool.eraserSize / 2);
      return;
    }
    if (tool.tool === "select" || tool.tool === "audio") {
      const hit = this.hitTest(point);
      this.setVoiceHover(hit && hit.type === "audio" ? hit : null, point);
    } else {
      this.setVoiceHover(null, point);
    }
  };

  private onPageLeave = (): void => {
    if (this.activeStroke || this.eraserState) return;
    this.ink.clearLive();
    this.setVoiceHover(null, { x: -1, y: -1 });
  };

  private isEraserActive(tool: ToolState): boolean {
    return tool.tool === "draw" && tool.brush === "eraser";
  }

  private onDoubleClick = (event: MouseEvent): void => {
    if (!this.page || this.page.kind === "contents") return;
    const point = this.pagePoint(event);
    const hit = this.hitTest(point);
    if (!hit) return;
    this.selectElement(hit);
    if (hit.type === "text" && !hit.locked) {
      const node = this.elementNodes.get(hit.id);
      if (node) this.beginEditing(hit, node, false);
    } else if (hit.type === "image" && !hit.locked) {
      this.host.openCrop(this, hit);
    }
  };

  private onContextMenu = (event: MouseEvent): void => {
    if (this.staticMode || !this.page) return;
    event.preventDefault();
    this.host.activatePage(this);
    if (this.page.kind === "contents") {
      this.host.openPageMenu(event, this);
      return;
    }
    const hit = this.hitTest(this.pagePoint(event));
    if (hit) {
      if (!this.selectedIds.has(hit.id)) this.selectElement(hit);
      this.host.openElementMenu(event, this, hit);
    } else {
      this.host.openPageMenu(event, this);
    }
  };

  private pagePoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / this.scale,
      y: (event.clientY - rect.top) / this.scale,
    };
  }

  // ---------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------

  private beginStroke(event: PointerEvent, point: { x: number; y: number }, tool: ToolState): void {
    if (!this.page) return;
    if (tool.brush === "eraser") return;
    const pressure = this.pointerPressure(event, tool);
    const first: RawPoint = {
      x: point.x,
      y: point.y,
      p: pressure,
      ...(this.pointerTilt(event) !== undefined ? { tilt: this.pointerTilt(event) } : {}),
    };
    this.ensureLayerCanvas("drawings");
    this.activeStroke = {
      pointerId: event.pointerId,
      points: [first],
      lastRaw: first,
      style: {
        brush: tool.brush,
        color: tool.brushSettings.color,
        size: tool.brushSettings.size,
        opacity: tool.brushSettings.opacity,
        pressureEnabled: tool.brushSettings.pressure && event.pointerType === "pen",
        assist: tool.brushSettings.assist ?? false,
      },
      frame: null,
    };
    this.host.audio.playPenDown();
    this.scheduleLiveRender();
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      /* not all environments support pointer capture */
    }
    const move = (moveEvent: PointerEvent) => {
      if (!this.activeStroke || moveEvent.pointerId !== this.activeStroke.pointerId) return;
      const events = typeof moveEvent.getCoalescedEvents === "function" ? moveEvent.getCoalescedEvents() : [moveEvent];
      const before = this.activeStroke.lastRaw;
      for (const sample of events) {
        this.appendStrokePoint(sample, this.activeStroke.style.pressureEnabled);
      }
      const after = this.activeStroke.lastRaw;
      if (before && after && after !== before) {
        const distance = Math.hypot(after.x - before.x, after.y - before.y) * this.scale;
        this.host.audio.continueWriting(Math.min(1, distance / 8));
      }
      this.scheduleLiveRender();
    };
    const up = (upEvent: PointerEvent) => {
      if (!this.activeStroke || upEvent.pointerId !== this.activeStroke.pointerId) return;
      this.finishStroke(true);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      try {
        this.root.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.gestureCleanup = cleanup;
  }

  private pointerPressure(event: PointerEvent, tool: ToolState): number {
    if (event.pointerType !== "pen") return 1;
    if (!tool.brushSettings.pressure) return 1;
    const raw = event.pressure;
    return raw > 0 && raw < 1 ? raw : 0.55;
  }

  private pointerTilt(event: PointerEvent): number | undefined {
    const tilt = Math.max(Math.abs(event.tiltX || 0), Math.abs(event.tiltY || 0)) / 90;
    return tilt > 0 ? tilt : undefined;
  }

  private appendStrokePoint(event: PointerEvent, pressureEnabled: boolean): void {
    if (!this.activeStroke) return;
    const point = this.pagePoint(event);
    const p = pressureEnabled && event.pointerType === "pen" ? event.pressure || 0.55 : 1;
    const tilt = this.pointerTilt(event);
    const raw: RawPoint = { x: point.x, y: point.y, p, ...(tilt !== undefined ? { tilt } : {}) };
    const last = this.activeStroke.lastRaw;
    if (last && Math.hypot(raw.x - last.x, raw.y - last.y) < 0.55) return;
    const smoothed = smoothPoint(last, raw, 0.36);
    this.activeStroke.points.push(smoothed);
    this.activeStroke.lastRaw = raw;
  }

  private scheduleLiveRender(): void {
    if (!this.activeStroke || this.activeStroke.frame !== null) return;
    this.activeStroke.frame = window.requestAnimationFrame(() => {
      if (!this.activeStroke) return;
      this.activeStroke.frame = null;
      this.ink.drawLiveStroke(this.activeStroke.points, this.activeStroke.style);
    });
  }

  private finishStroke(commit: boolean): void {
    const active = this.activeStroke;
    if (!active) return;
    if (active.frame !== null) {
      window.cancelAnimationFrame(active.frame);
      active.frame = null;
    }
    this.activeStroke = null;
    this.ink.clearLive();
    if (!commit || active.points.length < 2 || !this.page) return;
    const simplified = simplifyStroke(active.points, 0.3);
    const assisted = active.style.assist ? assistStroke(simplified, active.style.brush) : null;
    const finalPoints = assisted?.points ?? simplified;
    const el = createDrawingElement(
      {
        brush: active.style.brush,
        settings: {
          color: active.style.color,
          size: active.style.size,
          opacity: active.style.opacity,
          pressure: active.style.pressureEnabled,
        },
        points: finalPoints.map((p) => ({ x: p.x, y: p.y, p: p.p, ...(p.tilt !== undefined ? { tilt: p.tilt } : {}) })),
      },
      nextZ(this.page.elements),
    );
    if (!el) return;
    this.ensureLayerCanvas(el.layer);
    this.page.elements.push(el);
    this.ink.drawElement(el);
    this.contentEl.querySelector(".fb-page__empty")?.remove();
    this.pushAddHistory([el], "Draw stroke");
    this.markDirty();
    this.host.onPageEdited(this);
  }

  private beginErase(event: PointerEvent, point: { x: number; y: number }, tool: ToolState): void {
    if (!this.page) return;
    this.eraserState = { pointerId: event.pointerId, removed: [], layers: new Set() };
    this.eraseAt(point, tool.eraserSize);
    this.ink.drawEraser(point.x, point.y, tool.eraserSize / 2);
    const move = (moveEvent: PointerEvent) => {
      if (!this.eraserState || moveEvent.pointerId !== this.eraserState.pointerId) return;
      const p = this.pagePoint(moveEvent);
      this.eraseAt(p, tool.eraserSize);
      this.ink.drawEraser(p.x, p.y, tool.eraserSize / 2);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      const state = this.eraserState;
      this.eraserState = null;
      this.ink.clearLive();
      cleanup();
      if (!state || !state.removed.length) return;
      this.pushRemoveHistory(state.removed, "Erase");
      this.markDirty();
      this.host.onPageEdited(this);
      this.host.audio.play("objects");
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.gestureCleanup = cleanup;
  }

  private eraseAt(point: { x: number; y: number }, size: number): void {
    if (!this.page) return;
    const removedThisMove: PageElement[] = [];
    const hitLayers = new Set<LayerId>();
    this.page.elements = this.page.elements.filter((el) => {
      if (el.type !== "drawing") return true;
      if (!this.isLayerInteractive(el.layer)) return true;
      if (!hitTestDrawing(el, point, size / 2)) return true;
      removedThisMove.push(el);
      hitLayers.add(el.layer);
      this.selectedIds.delete(el.id);
      return false;
    });
    if (!removedThisMove.length) return;
    this.eraserState?.removed.push(...removedThisMove);
    for (const layerId of hitLayers) {
      const elements = this.page.elements.filter(
        (el): el is DrawingElement => el.type === "drawing" && el.layer === layerId,
      );
      this.ink.redrawLayer(layerId, elements);
      this.eraserState?.layers.add(layerId);
    }
    this.updateSelectionOverlay();
    this.markDirty();
  }

  // ---------------------------------------------------------------------
  // Shape creation
  // ---------------------------------------------------------------------

  private beginShapeCreation(start: { x: number; y: number }, tool: ToolState): void {
    if (!this.page) return;
    this.clearSelection();
    const preview = document.createElement("div");
    preview.className = "fb-shape-preview";
    this.contentEl.appendChild(preview);
    let last = start;
    const move = (moveEvent: PointerEvent) => {
      last = this.pagePoint(moveEvent);
      const bounds = normalizeRect(start, last);
      preview.style.left = `${bounds.x}px`;
      preview.style.top = `${bounds.y}px`;
      preview.style.width = `${Math.max(2, bounds.w)}px`;
      preview.style.height = `${Math.max(2, bounds.h)}px`;
    };
    const up = () => {
      cleanup();
      preview.remove();
      let bounds = normalizeRect(start, last);
      if (bounds.w < 4 && bounds.h < 4) {
        bounds = { x: start.x - 100, y: start.y - 70, w: 200, h: 140 };
      }
      const points =
        tool.shape === "line" || tool.shape === "arrow"
          ? [
              { x: start.x <= last.x ? 0 : 1, y: start.y <= last.y ? 0 : 1 },
              { x: start.x <= last.x ? 1 : 0, y: start.y <= last.y ? 1 : 0 },
            ]
          : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      const el = createShapeElement(
        tool.shape,
        { x: bounds.x, y: bounds.y, w: Math.max(12, bounds.w), h: Math.max(12, bounds.h) },
        points,
        {
          stroke: tool.shapeStyle.stroke,
          fill: tool.shapeStyle.fill,
          strokeWidth: tool.shapeStyle.strokeWidth,
          dashed: tool.shapeStyle.dashed,
          sides: tool.shapeStyle.sides,
          z: nextZ(this.page?.elements ?? []),
        },
      );
      if (!this.page) return;
      this.page.elements.push(el);
      this.pushAddHistory([el], "Add shape");
      this.markDirty();
      this.render();
      this.setSelection([el.id]);
      this.host.onPageEdited(this);
      this.host.afterToolUse();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.gestureCleanup = cleanup;
  }

  // ---------------------------------------------------------------------
  // Move / resize / rotate gestures
  // ---------------------------------------------------------------------

  private beginMove(
    event: PointerEvent,
    start: { x: number; y: number },
    onTap?: () => void,
  ): void {
    if (!this.page) return;
    const selected = this.getSelectedElements().filter(
      (el) => !el.pinned && !el.locked && this.isLayerInteractive(el.layer),
    );
    const targets = this.expandWithAttachments(selected).filter(
      (el) => !el.pinned && !el.locked && this.isLayerInteractive(el.layer),
    );
    if (!targets.length) return;
    const snapshot = this.captureGesture(targets, start, false);
    if (!snapshot) return;
    let guides: { axis: "x" | "y"; value: number }[] = [];
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const point = this.pagePoint(moveEvent);
      let dx = point.x - start.x;
      let dy = point.y - start.y;
      const snapped = this.computeSnap(snapshot, dx, dy, moveEvent.altKey);
      dx = snapped.dx;
      dy = snapped.dy;
      guides = snapped.guides;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) snapshot.moved = true;
      for (const target of snapshot.targets) {
        const before = snapshot.beforeById.get(target.id);
        if (!before) continue;
        target.x = before.x + dx;
        target.y = before.y + dy;
        const node = this.elementNodes.get(target.id);
        if (node) applyElementFrame(node, target);
      }
      if (snapshot.targets.some((target) => target.type === "drawing")) this.scheduleInkRedraw();
      this.updateSelectionOverlay();
      this.updateGuides(guides);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      cleanup();
      this.clearGuides();
      this.gestureCleanup = null;
      if (!snapshot.moved) {
        onTap?.();
        return;
      }
      if (!this.page) return;
      const before = snapshot.targets
        .map((el) => snapshot.beforeById.get(el.id))
        .filter((el): el is PageElement => !!el);
      const after = snapshot.targets.map((el) => deepClone(el));
      this.pushUpdateHistory(before, after, "Move");
      this.markDirty();
      this.host.audio.play("objects");
      this.host.onPageEdited(this);
      this.updateSelectionOverlay();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (this.gestureCleanup === cleanup) this.gestureCleanup = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.gestureCleanup = cleanup;
  }

  private captureGesture(
    targets: PageElement[],
    start: { x: number; y: number },
    single: boolean,
  ): GestureSnapshot | null {
    if (!targets.length) return null;
    const selected = this.getSelectedElements();
    const centerBounds = unionBounds(selected.length ? selected : targets);
    return {
      elements: selected,
      targets: targets.map((el) => el),
      start,
      groupCenter: { x: centerBounds.x + centerBounds.w / 2, y: centerBounds.y + centerBounds.h / 2 },
      startBounds: unionBounds(targets),
      single: single && targets.length === 1,
      moved: false,
      beforeById: new Map(targets.map((el) => [el.id, deepClone(el)])),
    };
  }

  private computeSnap(
    snapshot: GestureSnapshot,
    dx: number,
    dy: number,
    disable: boolean,
  ): { dx: number; dy: number; guides: { axis: "x" | "y"; value: number }[] } {
    if (disable || !this.page) return { dx, dy, guides: [] };
    const selectedIds = new Set(snapshot.targets.map((el) => el.id));
    const bounds = snapshot.startBounds;
    const movedBounds = { x: bounds.x + dx, y: bounds.y + dy, w: bounds.w, h: bounds.h };
    const settings = this.host.store.getSettings();
    const xTargets: number[] = [0, settings.pageWidth / 2, settings.pageWidth];
    const yTargets: number[] = [0, settings.pageHeight / 2, settings.pageHeight];
    for (const el of this.page.elements) {
      if (selectedIds.has(el.id)) continue;
      if (!this.layerState(el.layer)?.visible) continue;
      const elBounds = unionBounds([el]);
      xTargets.push(elBounds.x, elBounds.x + elBounds.w / 2, elBounds.x + elBounds.w);
      yTargets.push(elBounds.y, elBounds.y + elBounds.h / 2, elBounds.y + elBounds.h);
    }
    const xCandidates = [movedBounds.x, movedBounds.x + movedBounds.w / 2, movedBounds.x + movedBounds.w];
    const yCandidates = [movedBounds.y, movedBounds.y + movedBounds.h / 2, movedBounds.y + movedBounds.h];
    let bestX: { diff: number; guide: number } | null = null;
    let bestY: { diff: number; guide: number } | null = null;
    for (const candidate of xCandidates) {
      const result = snapValue(candidate, xTargets, SNAP_DISTANCE);
      if (result.hit !== null && (!bestX || Math.abs(result.value - candidate) < Math.abs(bestX.diff))) {
        bestX = { diff: result.value - candidate, guide: result.value };
      }
    }
    for (const candidate of yCandidates) {
      const result = snapValue(candidate, yTargets, SNAP_DISTANCE);
      if (result.hit !== null && (!bestY || Math.abs(result.value - candidate) < Math.abs(bestY.diff))) {
        bestY = { diff: result.value - candidate, guide: result.value };
      }
    }
    let finalDx = dx + (bestX?.diff ?? 0);
    let finalDy = dy + (bestY?.diff ?? 0);
    const guides: { axis: "x" | "y"; value: number }[] = [];
    if (settings.snapToGrid) {
      const grid = Math.max(4, settings.gridSize);
      if (!bestX) finalDx = Math.round((bounds.x + dx) / grid) * grid - bounds.x;
      if (!bestY) finalDy = Math.round((bounds.y + dy) / grid) * grid - bounds.y;
    }
    if (bestX) guides.push({ axis: "x", value: bestX.guide });
    if (bestY) guides.push({ axis: "y", value: bestY.guide });
    return { dx: finalDx, dy: finalDy, guides };
  }

  private beginTransformGesture(handle: HandleKind, event: PointerEvent): void {
    if (!this.page) return;
    if (handle === "rotate") {
      this.beginRotate(event);
      return;
    }
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    const movable = selected.filter(
      (el) => !el.pinned && !el.locked && this.isLayerInteractive(el.layer),
    );
    if (!movable.length) return;
    const targets = this.expandWithAttachments(movable).filter(
      (el) => !el.pinned && !el.locked && this.isLayerInteractive(el.layer),
    );
    const start = this.pagePoint(event);
    const single = selected.length === 1 && targets.length === 1;
    const snapshot = this.captureGesture(targets, start, single);
    if (!snapshot) return;
    const singleBefore = single ? deepClone(targets[0]) : null;
    const groupBounds = unionBounds(selected);
    let hasMoved = false;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const point = this.pagePoint(moveEvent);
      if (single && singleBefore) {
        const el = targets[0];
        const rad = degToRad(singleBefore.rotation);
        const center = centerOf(singleBefore);
        const vector = rotateVector(
          { x: point.x - center.x, y: point.y - center.y },
          -rad,
        );
        const local = { x: vector.x + singleBefore.w / 2, y: vector.y + singleBefore.h / 2 };
        let left = 0;
        let top = 0;
        let right = singleBefore.w;
        let bottom = singleBefore.h;
        if (handle.includes("w")) left = local.x;
        if (handle.includes("e")) right = local.x;
        if (handle.includes("n")) top = local.y;
        if (handle.includes("s")) bottom = local.y;
        if (right - left < MIN_ELEMENT_SIZE) {
          if (handle.includes("w")) left = right - MIN_ELEMENT_SIZE;
          else right = left + MIN_ELEMENT_SIZE;
        }
        if (bottom - top < MIN_ELEMENT_SIZE) {
          if (handle.includes("n")) top = bottom - MIN_ELEMENT_SIZE;
          else bottom = top + MIN_ELEMENT_SIZE;
        }
        const newW = el.type === "audio"
          ? clamp(right - left, VOICE_MIN_WIDTH, VOICE_MAX_WIDTH)
          : right - left;
        const newH = el.type === "audio" ? VOICE_HEIGHT : bottom - top;
        const newCenterLocal = { x: left + (right - left) / 2, y: top + (bottom - top) / 2 };
        const centerOffset = rotateVector(
          { x: newCenterLocal.x - singleBefore.w / 2, y: newCenterLocal.y - singleBefore.h / 2 },
          rad,
        );
        el.w = newW;
        el.h = newH;
        el.x = center.x + centerOffset.x - newW / 2;
        el.y = center.y + centerOffset.y - newH / 2;
        this.updateElementNode(el);
        hasMoved = true;
      } else {
        const rect = this.resizeRect(groupBounds, handle, point);
        const sx = groupBounds.w > 0 ? rect.w / groupBounds.w : 1;
        const sy = groupBounds.h > 0 ? rect.h / groupBounds.h : 1;
        for (const target of targets) {
          const before = snapshot.beforeById.get(target.id);
          if (!before) continue;
          target.x = rect.x + (before.x - groupBounds.x) * sx;
          target.y = rect.y + (before.y - groupBounds.y) * sy;
          target.w = Math.max(MIN_ELEMENT_SIZE, before.w * sx);
          target.h = Math.max(MIN_ELEMENT_SIZE, before.h * sy);
          this.updateElementNode(target);
        }
        hasMoved = true;
      }
      if (targets.some((el) => el.type === "drawing")) this.scheduleInkRedraw();
      this.updateSelectionOverlay();
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      cleanup();
      this.gestureCleanup = null;
      if (!hasMoved || !this.page) return;
      const before = targets
        .map((el) => snapshot.beforeById.get(el.id))
        .filter((el): el is PageElement => !!el);
      const after = targets.map((el) => deepClone(el));
      this.pushUpdateHistory(before, after, "Resize");
      this.markDirty();
      this.host.audio.play("objects");
      this.render();
      this.host.onPageEdited(this);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (this.gestureCleanup === cleanup) this.gestureCleanup = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.gestureCleanup = cleanup;
  }

  private resizeRect(start: Bounds, handle: HandleKind, point: { x: number; y: number }): Bounds {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;
    if (handle.includes("w")) left = Math.min(point.x, right - MIN_ELEMENT_SIZE);
    if (handle.includes("e")) right = Math.max(point.x, left + MIN_ELEMENT_SIZE);
    if (handle.includes("n")) top = Math.min(point.y, bottom - MIN_ELEMENT_SIZE);
    if (handle.includes("s")) bottom = Math.max(point.y, top + MIN_ELEMENT_SIZE);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  private beginRotate(event: PointerEvent): void {
    const selected = this.getSelectedElements().filter((el) => !el.pinned && !el.locked);
    if (!selected.length || !this.page) return;
    const targets = this.expandWithAttachments(selected).filter(
      (el) => !el.pinned && !el.locked && this.isLayerInteractive(el.layer),
    );
    const bounds = unionBounds(selected);
    const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const start = this.pagePoint(event);
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const before = new Map(targets.map((el) => [el.id, deepClone(el)]));
    let rotated = false;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const point = this.pagePoint(moveEvent);
      let delta = radToDeg(Math.atan2(point.y - center.y, point.x - center.x) - startAngle);
      if (moveEvent.shiftKey) delta = Math.round(delta / 15) * 15;
      if (Math.abs(delta) < 0.05) return;
      rotated = true;
      for (const target of targets) {
        const original = before.get(target.id);
        if (!original) continue;
        const originalCenter = centerOf(original);
        const rotatedCenter = rotatePoint(originalCenter, degToRad(delta), center);
        target.rotation = original.rotation + delta;
        if (targets.length > 1) {
          target.x = rotatedCenter.x - target.w / 2;
          target.y = rotatedCenter.y - target.h / 2;
        }
        this.updateElementNode(target);
      }
      if (targets.some((el) => el.type === "drawing")) this.scheduleInkRedraw();
      this.updateSelectionOverlay();
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      cleanup();
      this.gestureCleanup = null;
      if (!rotated || !this.page) return;
      const beforeSnapshot = targets
        .map((el) => before.get(el.id))
        .filter((el): el is PageElement => !!el);
      const after = targets.map((el) => deepClone(el));
      this.pushUpdateHistory(beforeSnapshot, after, "Rotate");
      this.markDirty();
      this.host.audio.play("objects");
      this.render();
      this.host.onPageEdited(this);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (this.gestureCleanup === cleanup) this.gestureCleanup = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.gestureCleanup = cleanup;
  }

  private updateElementNode(el: PageElement): void {
    const node = this.elementNodes.get(el.id);
    if (!node) return;
    if (el.type === "shape" || el.type === "audio") {
      node.replaceChildren();
      node.appendChild(createElementNode(el, (p) => this.host.resourcePath(p), (p) => this.host.attachmentExists(p)).firstElementChild ?? document.createElement("span"));
      applyElementFrame(node, el);
      return;
    }
    applyElementFrame(node, el);
  }

  // ---------------------------------------------------------------------
  // Marquee
  // ---------------------------------------------------------------------

  private beginMarquee(event: PointerEvent, start: { x: number; y: number }, additive: boolean): void {
    if (!this.page) return;
    const baseSelection = additive ? new Set(this.selectedIds) : new Set<string>();
    let moved = false;
    this.marqueeEl.classList.add("is-active");
    const update = (point: { x: number; y: number }) => {
      const rect = normalizeRect(start, point);
      this.marqueeEl.style.left = `${rect.x * this.scale}px`;
      this.marqueeEl.style.top = `${rect.y * this.scale}px`;
      this.marqueeEl.style.width = `${rect.w * this.scale}px`;
      this.marqueeEl.style.height = `${rect.h * this.scale}px`;
      return rect;
    };
    update(start);
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const point = this.pagePoint(moveEvent);
      const rect = update(point);
      if (rect.w > 2 || rect.h > 2) moved = true;
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      cleanup();
      this.marqueeEl.classList.remove("is-active");
      if (!moved || !this.page) return;
      const point = this.pagePoint(upEvent);
      const rect = normalizeRect(start, point);
      const hits = this.page.elements.filter((el) => {
        if (el.locked) return false;
        if (!this.isLayerInteractive(el.layer)) return false;
        if (el.type === "decoration" && el.attachTo && baseSelection.has(el.attachTo)) return true;
        const bounds = unionBounds([el]);
        return !(bounds.x + bounds.w < rect.x || rect.x + rect.w < bounds.x || bounds.y + bounds.h < rect.y || rect.y + rect.h < bounds.y);
      });
      const ids = new Set(baseSelection);
      for (const hit of hits) for (const member of this.groupMembers(hit)) ids.add(member.id);
      this.setSelection(ids);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (this.gestureCleanup === cleanup) this.gestureCleanup = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.gestureCleanup = cleanup;
  }

  // ---------------------------------------------------------------------
  // Content creation
  // ---------------------------------------------------------------------

  private createTextAt(point: { x: number; y: number }): void {
    if (!this.page) return;
    const el = createTextElement(point.x - 12, point.y - 16, {
      z: nextZ(this.page.elements),
      w: 380,
      h: 92,
    });
    this.page.elements.push(el);
    this.render();
    this.setSelection([el.id]);
    this.markDirty();
    const node = this.elementNodes.get(el.id);
    if (node) this.beginEditing(el, node, true);
    this.host.afterToolUse();
    this.host.onPageEdited(this);
  }

  insertText(text: string, at?: { x: number; y: number }): TextElement | null {
    if (!this.page) return null;
    const pageWidth = this.host.store.getSettings().pageWidth;
    const pageHeight = this.host.store.getSettings().pageHeight;
    const width = Math.min(520, pageWidth * 0.6);
    const el = createTextElement(at ? at.x - width / 2 : pageWidth / 2 - width / 2, at ? at.y - 30 : pageHeight / 2 - 60, {
      text,
      w: width,
      h: Math.max(70, Math.min(420, text.length * 0.8)),
      z: nextZ(this.page.elements),
    });
    this.page.elements.push(el);
    this.pushAddHistory([el], "Paste text");
    this.markDirty();
    this.render();
    this.setSelection([el.id]);
    this.host.onPageEdited(this);
    return el;
  }

  editSelectedText(): void {
    const el = this.getSelectedElements().find((candidate): candidate is TextElement => candidate.type === "text");
    if (!el) return;
    const node = this.elementNodes.get(el.id);
    if (node) this.beginEditing(el, node, false);
  }

  insertImage(attachment: string, naturalW: number, naturalH: number, at?: { x: number; y: number }): ImageElement | null {
    if (!this.page) return null;
    const pageWidth = this.host.store.getSettings().pageWidth;
    const pageHeight = this.host.store.getSettings().pageHeight;
    const width = Math.min(520, pageWidth * 0.52);
    const ratio = naturalW > 0 && naturalH > 0 ? naturalH / naturalW : 0.75;
    const height = Math.min(pageHeight * 0.6, width * ratio);
    const x = at ? clamp(at.x - width / 2, 20, pageWidth - width - 20) : (pageWidth - width) / 2 + randomOffset(10);
    const y = at ? clamp(at.y - height / 2, 20, pageHeight - height - 20) : (pageHeight - height) / 2 + randomOffset(10);
    const el = createImageElement(attachment, naturalW, naturalH, x, y, {
      w: width,
      h: height,
      z: nextZ(this.page.elements),
    });
    this.page.elements.push(el);
    this.pushAddHistory([el], "Add photo");
    this.markDirty();
    this.render();
    this.setSelection([el.id]);
    this.host.audio.play("objects");
    this.host.onPageEdited(this);
    return el;
  }

  insertDecorationAt(decor: DecorKind, point?: { x: number; y: number }, attachTo?: ImageElement): DecorationElement | null {
    if (!this.page) return null;
    const pageWidth = this.host.store.getSettings().pageWidth;
    const pageHeight = this.host.store.getSettings().pageHeight;
    const position = point ?? { x: pageWidth / 2, y: pageHeight / 2 };
    const el = createDecorationElement(decor, position.x, position.y, {
      rotation: decor === "tape" ? -6 + Math.random() * 12 : 0,
      z: nextZ(this.page.elements),
      attachTo: attachTo?.id ?? null,
    });
    el.x -= el.w / 2;
    el.y -= el.h / 2;
    this.page.elements.push(el);
    this.pushAddHistory([el], "Add decoration");
    this.markDirty();
    this.render();
    this.setSelection([el.id]);
    this.host.audio.play("objects");
    this.host.onPageEdited(this);
    return el;
  }

  addTapeToImage(image?: ImageElement): void {
    let target = image ?? this.getSelectedElements().find((el): el is ImageElement => el.type === "image");
    if (!target && this.page) {
      target = this.page.elements.find((el): el is ImageElement => el.type === "image");
    }
    if (!target || !this.page) return;
    const existing = this.page.elements.filter(
      (el): el is DecorationElement => el.type === "decoration" && el.attachTo === target?.id,
    );
    const tape = createTapeForImage(target, existing.length, existing.length % 2 ? "cream" : "ocean");
    this.page.elements.push(tape);
    this.pushAddHistory([tape], "Tape photo");
    this.markDirty();
    this.render();
    this.setSelection([target.id]);
    this.host.audio.play("objects");
    this.host.onPageEdited(this);
  }

  applyCropToImage(imageId: string, crop: ImageElement["crop"]): void {
    if (!this.page) return;
    const image = this.page.elements.find(
      (el): el is ImageElement => el.type === "image" && el.id === imageId,
    );
    if (!image) return;
    this.setSelection([image.id]);
    this.patchSelected("Crop photo", (el) => {
      if (el.type === "image" && el.id === imageId) el.crop = { ...crop };
    });
  }

  // ---------------------------------------------------------------------
  // Voice notes
  // ---------------------------------------------------------------------

  private voicePlacementId: string | null = null;
  private voiceHover: string | null = null;

  private voiceLocal(el: AudioElement, point: { x: number; y: number }): { x: number; y: number } {
    const rotated = rotatePoint(point, -degToRad(el.rotation), centerOf(el));
    return { x: rotated.x - el.x, y: rotated.y - el.y };
  }

  /** Which part of the note the pointer is on: the drawn ring, the ink wave, or the paper. */
  private voiceZone(
    el: AudioElement,
    point: { x: number; y: number },
  ): "play" | "wave" | null {
    const local = this.voiceLocal(el, point);
    const parts = voiceParts(el.w, el.h);
    const inside = (rect: { x: number; y: number; w: number; h: number }) =>
      local.x >= rect.x && local.x <= rect.x + rect.w && local.y >= rect.y && local.y <= rect.y + rect.h;
    if (inside(parts.play)) return "play";
    if (inside(parts.wave)) return "wave";
    return null;
  }

  private voiceRatioAt(el: AudioElement, point: { x: number; y: number }): number {
    const local = this.voiceLocal(el, point);
    const parts = voiceParts(el.w, el.h);
    return clamp((local.x - parts.wave.x) / Math.max(1, parts.wave.w), 0, 1);
  }

  /** Lights the drawn ring when the pointer hovers the play area. */
  private setVoiceHover(el: AudioElement | null, point: { x: number; y: number }): void {
    const zone = el ? this.voiceZone(el, point) : null;
    const key = el && zone ? `${el.id}:${zone}` : "";
    if (this.voiceHover === key) return;
    if (this.voiceHover) {
      const previous = this.elementNodes.get(this.voiceHover.split(":")[0])?.querySelector(".fb-voice");
      previous?.classList.remove("is-over-play");
    }
    this.voiceHover = key;
    this.root.dataset.voiceZone = zone ?? "";
    if (zone === "play" && el) {
      this.elementNodes.get(el.id)?.querySelector(".fb-voice")?.classList.add("is-over-play");
    }
  }

  isVoicePlacement(elementId: string): boolean {
    return this.voicePlacementId === elementId;
  }

  markVoicePlacement(elementId: string | null): void {
    this.voicePlacementId = elementId;
  }

  /** The note that grows while the microphone runs; it has no file yet. */
  createVoicePlaceholder(
    point: { x: number; y: number },
    options: { color: string; mount: AudioElement["mount"] },
  ): AudioElement | null {
    if (!this.page) return null;
    const el = createAudioElement({
      attachment: "",
      duration: 0,
      peaks: [0.06],
      x: point.x - 172,
      y: point.y - VOICE_HEIGHT / 2,
      color: options.color,
      mount: options.mount,
      width: 344,
    }, nextZ(this.page.elements));
    el.rotation = -0.6;
    this.page.elements.push(el);
    this.render();
    this.setSelection([el.id]);
    this.host.onPageEdited(this);
    return el;
  }

  updateVoiceLevels(elementId: string, peaks: number[], seconds: number): void {
    const node = this.elementNodes.get(elementId);
    if (node) applyVoiceLevels(node, peaks, seconds);
  }

  finishVoicePlacement(
    elementId: string,
    data: { attachment: string; duration: number; peaks: number[] },
  ): void {
    if (!this.page) return;
    const el = this.page.elements.find(
      (candidate): candidate is AudioElement =>
        candidate.type === "audio" && candidate.id === elementId,
    );
    if (!el) return;
    el.attachment = data.attachment;
    el.duration = data.duration;
    el.peaks = data.peaks;
    this.voicePlacementId = null;
    this.markDirty();
    this.pushAddHistory([el], "Add voice note");
    this.render();
    this.setSelection([el.id]);
    this.host.audio.play("objects");
    this.host.onPageEdited(this);
  }

  cancelVoicePlacement(elementId: string): void {
    if (!this.page) return;
    this.page.elements = this.page.elements.filter((el) => el.id !== elementId);
    this.voicePlacementId = null;
    this.clearSelection();
    this.render();
    this.host.onPageEdited(this);
  }

  applyVoiceProgressTo(elementId: string, ratio: number, playing: boolean): void {
    const node = this.elementNodes.get(elementId);
    if (node) applyVoiceProgress(node, ratio, playing);
  }

  updateSelectedVoice(patch: Partial<AudioElement>): void {
    this.patchSelected("Adjust voice note", (el) => {
      if (el.type === "audio") Object.assign(el, patch);
    });
  }

  resetVoiceProgress(elementId: string): void {
    this.applyVoiceProgressTo(elementId, 0, false);
  }

  // ---------------------------------------------------------------------
  // Text editing
  // ---------------------------------------------------------------------

  private beginEditing(el: TextElement, node: HTMLElement, isNew: boolean): void {
    if (this.editing) this.finishEditing(true);
    const body = node.querySelector<HTMLElement>(".fb-text");
    if (!body) return;
    node.classList.add("is-editing");
    body.classList.add("is-editing");
    body.dataset.placeholder = "Start typing\u2026";
    body.setAttribute("contenteditable", "true");
    body.setAttribute("spellcheck", "false");
    const before = deepClone(el);
    const cleanupFns: (() => void)[] = [];
    cleanupFns.push(() => {
      body.dataset.placeholder = "Double-click to write";
    });
    const inputHandler = () => {
      el.text = (body.innerText ?? "").replace(/\n{3,}/g, "\n\n");
      body.classList.toggle("is-empty", !el.text.trim());
      const needed = Math.max(40, body.scrollHeight);
      if (needed > el.h) {
        el.h = needed;
        node.style.height = `${el.h}px`;
      }
      this.markDirty();
      this.updateSelectionOverlay();
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.cancelEditing();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.finishEditing(true);
      } else if (!event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const typing = event.key.length === 1;
        const editing =
          event.key === "Backspace" ||
          event.key === "Delete" ||
          (event.key === "Enter" && !event.shiftKey);
        if (typing || editing) this.host.audio.playTyping();
      }
      event.stopPropagation();
    };
    const blurHandler = () => {
      window.setTimeout(() => {
        if (this.editing && this.editing.body === body) this.finishEditing(true);
      }, 0);
    };
    body.addEventListener("input", inputHandler);
    body.addEventListener("keydown", keyHandler);
    body.addEventListener("blur", blurHandler);
    cleanupFns.push(() => body.removeEventListener("input", inputHandler));
    cleanupFns.push(() => body.removeEventListener("keydown", keyHandler));
    cleanupFns.push(() => body.removeEventListener("blur", blurHandler));
    this.editing = {
      id: el.id,
      before,
      isNew,
      node,
      body,
      cleanup: () => cleanupFns.forEach((fn) => fn()),
    };
    this.updateSelectionOverlay();
    body.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(body);
      if (!isNew) range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  finishEditing(save: boolean): void {
    const state = this.editing;
    if (!state) return;
    this.editing = null;
    state.cleanup();
    const page = this.page;
    if (!page) return;
    const el = page.elements.find((candidate): candidate is TextElement => candidate.id === state.id && candidate.type === "text");
    if (!el) {
      state.body.removeAttribute("contenteditable");
      state.node.classList.remove("is-editing");
      state.body.classList.remove("is-editing");
      return;
    }
    el.text = state.body.innerText ?? "";
    state.body.removeAttribute("contenteditable");
    state.node.classList.remove("is-editing");
    state.body.classList.remove("is-editing");
    if (!save) {
      if (state.isNew) {
        page.elements = page.elements.filter((candidate) => candidate.id !== state.id);
        this.selectedIds.delete(state.id);
        this.markDirty();
        this.render();
        this.host.onSelectionChange(this);
        return;
      }
      el.text = state.before.text;
      el.h = state.before.h;
      this.markDirty();
      this.render();
      return;
    }
    if (state.isNew) {
      if (!el.text.trim()) {
        page.elements = page.elements.filter((candidate) => candidate.id !== state.id);
        this.selectedIds.delete(state.id);
        this.markDirty();
        this.render();
        this.host.onSelectionChange(this);
        return;
      }
      this.pushAddHistory([el], "Add text");
      this.host.afterToolUse();
    } else if (el.text !== state.before.text || el.h !== state.before.h) {
      this.pushUpdateHistory([state.before], [deepClone(el)], "Edit text");
    }
    this.markDirty();
    this.render();
    this.host.onSelectionChange(this);
    this.host.onPageEdited(this);
  }

  private cancelEditing(): void {
    this.finishEditing(false);
  }

  // ---------------------------------------------------------------------
  // Public editing operations used by menus and toolbar
  // ---------------------------------------------------------------------

  deleteSelection(): void {
    if (!this.page) return;
    const elements = this.expandWithAttachments(this.getSelectedElements()).filter(
      (el) => !el.locked && this.isLayerInteractive(el.layer),
    );
    if (!elements.length) return;
    const ids = new Set(elements.map((el) => el.id));
    this.page.elements = this.page.elements.filter((el) => !ids.has(el.id));
    this.pushRemoveHistory(elements, "Delete");
    this.selectedIds.clear();
    this.markDirty();
    this.render();
    this.host.audio.play("objects");
    this.host.onSelectionChange(this);
    this.host.onPageEdited(this);
  }

  duplicateSelection(): void {
    if (!this.page) return;
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    const withAttachments = this.expandWithAttachments(selected);
    const copies = this.cloneForPaste(withAttachments, 24);
    if (!copies.length) return;
    this.page.elements.push(...copies);
    this.pushAddHistory(copies, "Duplicate");
    this.markDirty();
    this.render();
    this.setSelection(copies.map((el) => el.id));
    this.host.audio.play("objects");
    this.host.onPageEdited(this);
  }

  serializeSelection(): PageElement[] {
    return this.expandWithAttachments(this.getSelectedElements()).map((el) => deepClone(el));
  }

  pasteElements(elements: PageElement[], offset = 26): void {
    if (!this.page || !elements.length) return;
    const copies = this.cloneForPaste(elements, offset);
    this.page.elements.push(...copies);
    this.pushAddHistory(copies, "Paste");
    this.markDirty();
    this.render();
    this.setSelection(copies.map((el) => el.id));
    this.host.audio.play("objects");
    this.host.onPageEdited(this);
  }

  private cloneForPaste(elements: PageElement[], offset: number): PageElement[] {
    const idMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    const clones = elements.map((el) => {
      const clone = deepClone(el);
      clone.id = uid("el");
      idMap.set(el.id, clone.id);
      clone.x += offset;
      clone.y += offset;
      clone.z = nextZ(this.page?.elements ?? []);
      if (el.groupId) {
        if (!groupMap.has(el.groupId)) groupMap.set(el.groupId, uid("group"));
        clone.groupId = groupMap.get(el.groupId) ?? null;
      }
      return clone;
    });
    for (const clone of clones) {
      if (clone.type === "decoration" && clone.attachTo) {
        clone.attachTo = idMap.get(clone.attachTo) ?? null;
      }
    }
    return clones;
  }

  groupSelection(): void {
    const selected = this.getSelectedElements();
    if (selected.length < 2) return;
    const groupId = uid("group");
    this.patchElements(selected, "Group", () => {
      selected.forEach((el) => {
        el.groupId = groupId;
      });
    }, false);
  }

  ungroupSelection(): void {
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    this.patchElements(selected, "Ungroup", () => {
      selected.forEach((el) => {
        el.groupId = null;
      });
    }, false);
  }

  togglePinSelection(): void {
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    const target = selected[0]?.pinned ? false : true;
    this.patchElements(selected, target ? "Pin" : "Unpin", () => {
      selected.forEach((el) => {
        el.pinned = target;
      });
    }, true);
    this.updateSelectionOverlay();
  }

  toggleLockSelection(): void {
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    const target = selected[0]?.locked ? false : true;
    this.patchElements(selected, target ? "Lock" : "Unlock", () => {
      selected.forEach((el) => {
        el.locked = target;
      });
    }, true);
    if (target) this.clearSelection();
  }

  reorderSelection(mode: "front" | "back" | "forward" | "backward"): void {
    if (!this.page) return;
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    const before = selected.map((el) => deepClone(el));
    const layers = new Set(selected.map((el) => el.layer));
    for (const layerId of layers) {
      const ordered = this.page.elements
        .filter((el) => el.layer === layerId)
        .sort((a, b) => a.z - b.z);
      const isSelected = (el: PageElement) => this.selectedIds.has(el.id);
      if (mode === "front") {
        ordered.sort((a, b) => Number(isSelected(a)) - Number(isSelected(b)));
      } else if (mode === "back") {
        ordered.sort((a, b) => Number(isSelected(b)) - Number(isSelected(a)));
      } else if (mode === "forward") {
        for (let i = ordered.length - 2; i >= 0; i--) {
          if (isSelected(ordered[i]) && !isSelected(ordered[i + 1])) {
            [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
          }
        }
      } else {
        for (let i = 1; i < ordered.length; i++) {
          if (isSelected(ordered[i]) && !isSelected(ordered[i - 1])) {
            [ordered[i], ordered[i - 1]] = [ordered[i - 1], ordered[i]];
          }
        }
      }
      ordered.forEach((el, index) => {
        el.z = index + 1;
      });
    }
    const after = selected.map((el) => deepClone(el));
    this.pushUpdateHistory(before, after, "Reorder");
    this.markDirty();
    this.render();
    this.host.onPageEdited(this);
  }

  moveSelectionToLayer(layerId: LayerId): void {
    if (!this.page) return;
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    const before = selected.map((el) => deepClone(el));
    const layer = this.layerState(layerId);
    if (!layer) return;
    for (const el of selected) {
      el.layer = layerId;
      el.z = nextZ(this.page.elements);
    }
    const after = selected.map((el) => deepClone(el));
    this.pushUpdateHistory(before, after, "Move to layer");
    this.markDirty();
    this.render();
    this.host.onPageEdited(this);
  }

  updateSelectedText(patch: Partial<TextElement>): void {
    this.patchSelected("Format text", (el) => {
      if (el.type === "text") Object.assign(el, patch);
    });
  }

  updateSelectedImage(patch: Partial<ImageElement>): void {
    this.patchSelected("Adjust photo", (el) => {
      if (el.type === "image") Object.assign(el, patch);
    });
  }

  updateSelectedShape(patch: Partial<ShapeElement>): void {
    this.patchSelected("Adjust shape", (el) => {
      if (el.type === "shape") Object.assign(el, patch);
    });
  }

  updateSelectedDecoration(patch: Partial<DecorationElement>): void {
    this.patchSelected("Adjust decoration", (el) => {
      if (el.type === "decoration") Object.assign(el, patch);
    });
  }

  updateSelectedBase(patch: Partial<Pick<PageElement, "opacity" | "rotation">>): void {
    this.patchSelected("Adjust element", (el) => {
      if (patch.opacity !== undefined) el.opacity = patch.opacity;
      if (patch.rotation !== undefined) el.rotation = patch.rotation;
    });
  }

  private patchSelected(label: string, mutator: (el: PageElement) => void): void {
    this.commitLiveEdit(label);
    if (this.editing) this.finishEditing(true);
    const selected = this.getSelectedElements();
    if (!selected.length) return;
    const before = selected.map((el) => deepClone(el));
    for (const el of selected) mutator(el);
    const after = selected.map((el) => deepClone(el));
    this.pushUpdateHistory(before, after, label);
    this.markDirty();
    this.render();
    this.host.onSelectionChange(this);
    this.host.onPageEdited(this);
  }

  private patchElements(elements: PageElement[], label: string, mutator: () => void, render: boolean): void {
    if (!elements.length) return;
    const before = elements.map((el) => deepClone(el));
    mutator();
    const after = elements.map((el) => deepClone(el));
    this.pushUpdateHistory(before, after, label);
    this.markDirty();
    if (render) this.render();
    else {
      this.updateSelectionOverlay();
      this.host.onSelectionChange(this);
    }
    this.host.onPageEdited(this);
  }

  // ---------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------

  setLayerVisible(layerId: LayerId, visible: boolean): void {
    if (!this.page) return;
    const layer = this.page.layers.find((entry) => entry.id === layerId);
    if (!layer) return;
    layer.visible = visible;
    if (!visible) {
      for (const el of this.getSelectedElements()) {
        if (el.layer === layerId) this.selectedIds.delete(el.id);
      }
    }
    this.markDirty();
    this.render();
    this.host.onSelectionChange(this);
    this.host.onPageEdited(this);
  }

  setLayerLocked(layerId: LayerId, locked: boolean): void {
    if (!this.page) return;
    const layer = this.page.layers.find((entry) => entry.id === layerId);
    if (!layer) return;
    layer.locked = locked;
    if (locked) {
      for (const el of this.getSelectedElements()) {
        if (el.layer === layerId) this.selectedIds.delete(el.id);
      }
    }
    this.markDirty();
    this.render();
    this.host.onSelectionChange(this);
    this.host.onPageEdited(this);
  }

  moveLayer(layerId: LayerId, delta: number): void {
    if (!this.page) return;
    const index = this.page.layers.findIndex((layer) => layer.id === layerId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= this.page.layers.length) return;
    const [layer] = this.page.layers.splice(index, 1);
    this.page.layers.splice(target, 0, layer);
    this.markDirty();
    this.render();
    this.host.onPageEdited(this);
  }

  // ---------------------------------------------------------------------
  // Keyboard helpers
  // ---------------------------------------------------------------------

  nudgeSelection(dx: number, dy: number): void {
    const selected = this.getSelectedElements().filter(
      (el) => !el.pinned && !el.locked && this.isLayerInteractive(el.layer),
    );
    if (!selected.length) return;
    const targets = this.expandWithAttachments(selected);
    const before = targets.map((el) => deepClone(el));
    targets.forEach((el) => {
      el.x += dx;
      el.y += dy;
      this.updateElementNode(el);
    });
    if (targets.some((el) => el.type === "drawing")) this.scheduleInkRedraw();
    const after = targets.map((el) => deepClone(el));
    this.pushUpdateHistory(before, after, "Nudge");
    this.markDirty();
    this.updateSelectionOverlay();
    this.host.onPageEdited(this);
  }

  // ---------------------------------------------------------------------
  // History helpers
  // ---------------------------------------------------------------------

  private markDirty(): void {
    if (this.page) this.host.store.markPageDirty(this.page.id);
  }

  private pushAddHistory(elements: PageElement[], label: string): void {
    const snapshot = elements.map((el) => deepClone(el));
    const ids = new Set(elements.map((el) => el.id));
    this.host.history.push({
      label,
      undo: () => {
        if (!this.page) return;
        this.page.elements = this.page.elements.filter((el) => !ids.has(el.id));
        this.afterHistory();
      },
      redo: () => {
        if (!this.page) return;
        this.page.elements.push(...snapshot.map((el) => deepClone(el)));
        this.afterHistory();
      },
    });
  }

  private pushRemoveHistory(elements: PageElement[], label: string): void {
    const snapshot = elements.map((el) => deepClone(el));
    const ids = new Set(elements.map((el) => el.id));
    this.host.history.push({
      label,
      undo: () => {
        if (!this.page) return;
        this.page.elements.push(...snapshot.map((el) => deepClone(el)));
        this.afterHistory();
      },
      redo: () => {
        if (!this.page) return;
        this.page.elements = this.page.elements.filter((el) => !ids.has(el.id));
        this.afterHistory();
      },
    });
  }

  private pushUpdateHistory(before: PageElement[], after: PageElement[], label: string): void {
    const beforeSnapshot = before.map((el) => deepClone(el));
    const afterSnapshot = after.map((el) => deepClone(el));
    this.host.history.push({
      label,
      undo: () => {
        if (!this.page) return;
        this.replaceElements(beforeSnapshot);
        this.afterHistory();
      },
      redo: () => {
        if (!this.page) return;
        this.replaceElements(afterSnapshot);
        this.afterHistory();
      },
    });
  }

  private replaceElements(snapshot: PageElement[]): void {
    if (!this.page) return;
    const ids = new Set(snapshot.map((el) => el.id));
    this.page.elements = this.page.elements.filter((el) => !ids.has(el.id)).concat(snapshot.map((el) => deepClone(el)));
  }

  private afterHistory(): void {
    if (!this.page) return;
    this.selectedIds = new Set(
      Array.from(this.selectedIds).filter((id) => this.page?.elements.some((el) => el.id === id)),
    );
    this.markDirty();
    if (this.destroyed) {
      this.host.onPageContentChanged(this.page.id);
      return;
    }
    this.render();
    this.host.onSelectionChange(this);
    this.host.onPageEdited(this);
  }

  externalPageChanged(): void {
    if (!this.page || this.destroyed) return;
    this.render();
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  commitPending(): void {
    this.commitLiveEdit("Adjust");
    if (this.editing) this.finishEditing(true);
    if (this.activeStroke) this.finishStroke(true);
    if (this.eraserState) {
      const state = this.eraserState;
      this.eraserState = null;
      if (state.removed.length) {
        this.pushRemoveHistory(state.removed, "Erase");
        this.markDirty();
      }
    }
    this.gestureCleanup?.();
    this.gestureCleanup = null;
    this.clearGuides();
  }

  destroy(): void {
    this.commitPending();
    this.destroyed = true;
    this.gestureCleanup?.();
    this.gestureCleanup = null;
    if (this.inkFrame !== null) window.cancelAnimationFrame(this.inkFrame);
    this.ink.destroy();
    this.ink = new InkRenderer();
    this.root.remove();
  }
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function centerScreen(points: { x: number; y: number }[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
}

function rotateVector(v: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

function randomOffset(amount: number): number {
  return (Math.random() - 0.5) * amount;
}
