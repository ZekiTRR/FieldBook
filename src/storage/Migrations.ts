import {
  DATA_VERSION,
  DEFAULT_JOURNAL_SETTINGS,
  DEFAULT_LAYERS,
  type AudioElement,
  type DecorationElement,
  type DrawingElement,
  type ElementBase,
  type ImageElement,
  type JournalData,
  type JournalSettings,
  type LayerId,
  type LayerState,
  type PageBackground,
  type PageData,
  type PageElement,
  type PageKind,
  type PageMeta,
  type ShapeElement,
  type TabColor,
  type TabData,
  type TextElement,
  type ThemeId,
  type TrashedPage,
} from "../types";
import { uid, nowIso } from "../utils";
import { VOICE_HEIGHT, VOICE_MAX_WIDTH, VOICE_MIN_WIDTH } from "../elements/VoiceWave";

const LAYER_IDS: LayerId[] = ["background", "content", "drawings", "decorations"];
const TAB_COLORS: TabColor[] = ["cream", "ocean", "sage", "rust", "plum", "gold", "charcoal", "rose"];
const THEMES: ThemeId[] = ["classic", "manuscript", "clean", "dark", "field"];
const BACKGROUNDS: PageBackground[] = ["plain", "ruled", "grid", "dots"];
const VOICE_MOUNTS: AudioElement["mount"][] = ["tape", "corners", "none"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function iso(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

function layerId(value: unknown): LayerId {
  return LAYER_IDS.includes(value as LayerId) ? (value as LayerId) : "content";
}

function normalizeBase(raw: Record<string, unknown>, type: PageElement["type"]): ElementBase {
  return {
    id: str(raw.id) || uid("el"),
    type,
    layer: layerId(raw.layer),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: num(raw.w, 120, 4),
    h: num(raw.h, 60, 4),
    rotation: num(raw.rotation, 0, -100000, 100000),
    z: num(raw.z, 1),
    opacity: num(raw.opacity, 1, 0, 1),
    locked: bool(raw.locked),
    pinned: bool(raw.pinned),
    groupId: typeof raw.groupId === "string" ? raw.groupId : null,
  };
}

function normalizeElement(raw: unknown): PageElement | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (type === "text") {
    const base = normalizeBase(raw, "text");
    const el: TextElement = {
      ...base,
      type: "text",
      text: str(raw.text, ""),
      fontFamily: ["body", "title", "serif", "mono"].includes(str(raw.fontFamily))
        ? (raw.fontFamily as TextElement["fontFamily"])
        : "body",
      fontSize: num(raw.fontSize, 24, 6, 300),
      color: str(raw.color, "ink"),
      bold: bool(raw.bold),
      italic: bool(raw.italic),
      underline: bool(raw.underline),
      align: ["left", "center", "right"].includes(str(raw.align))
        ? (raw.align as TextElement["align"])
        : "left",
      lineHeight: num(raw.lineHeight, 1.35, 0.8, 3),
      link: str(raw.link, ""),
    };
    return el;
  }
  if (type === "image") {
    const base = normalizeBase(raw, "image");
    const rawCrop = isRecord(raw.crop) ? raw.crop : {};
    const el: ImageElement = {
      ...base,
      type: "image",
      attachment: str(raw.attachment, ""),
      naturalW: num(raw.naturalW, 0, 0),
      naturalH: num(raw.naturalH, 0, 0),
      crop: {
        x: num(rawCrop.x, 0, 0, 1),
        y: num(rawCrop.y, 0, 0, 1),
        w: num(rawCrop.w, 1, 0.02, 1),
        h: num(rawCrop.h, 1, 0.02, 1),
      },
      border: bool(raw.border, true),
      shadow: bool(raw.shadow, true),
      radius: num(raw.radius, 2, 0, 200),
    };
    return el;
  }
  if (type === "shape") {
    const base = normalizeBase(raw, "shape");
    const pointsRaw = Array.isArray(raw.points) ? raw.points : [];
    const points = pointsRaw
      .filter(isRecord)
      .map((p) => ({ x: num(p.x, 0), y: num(p.y, 0) }))
      .slice(0, 64);
    const el: ShapeElement = {
      ...base,
      type: "shape",
      shape: ["line", "arrow", "rect", "ellipse", "polygon"].includes(str(raw.shape))
        ? (raw.shape as ShapeElement["shape"])
        : "rect",
      stroke: str(raw.stroke, "ink"),
      fill: str(raw.fill, "none"),
      strokeWidth: num(raw.strokeWidth, 3, 0.5, 60),
      points: points.length ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      sides: Math.round(num(raw.sides, 5, 3, 12)),
      dashed: bool(raw.dashed),
    };
    return el;
  }
  if (type === "decoration") {
    const base = normalizeBase(raw, "decoration");
    const el: DecorationElement = {
      ...base,
      type: "decoration",
      decor: [
        "tape",
        "glue",
        "sticker",
        "bookmark",
        "frame",
        "marker",
        "photoCorner",
      ].includes(str(raw.decor))
        ? (raw.decor as DecorationElement["decor"])
        : "tape",
      color: str(raw.color, "accent"),
      variant: num(raw.variant, 0),
      attachTo: typeof raw.attachTo === "string" ? raw.attachTo : null,
    };
    return el;
  }
  if (type === "drawing") {
    const base = normalizeBase(raw, "drawing");
    const rawPoints = Array.isArray(raw.points) ? raw.points : [];
    const points = rawPoints
      .filter(isRecord)
      .map((p) => ({
        x: num(p.x, 0),
        y: num(p.y, 0),
        p: num(p.p, 0.6, 0, 1),
        ...(typeof p.tilt === "number" ? { tilt: p.tilt } : {}),
      }));
    if (points.length < 1) return null;
    const el: DrawingElement = {
      ...base,
      type: "drawing",
      brush: ["pen", "pencil", "marker", "highlighter"].includes(str(raw.brush))
        ? (raw.brush as DrawingElement["brush"])
        : "pen",
      color: str(raw.color, "ink"),
      size: num(raw.size, 3, 0.5, 120),
      sampleOpacity: num(raw.sampleOpacity, 1, 0.02, 1),
      points,
      seed: Math.round(num(raw.seed, Math.random() * 1e9)),
      baseW: num(raw.baseW, base.w, 1),
      baseH: num(raw.baseH, base.h, 1),
    };
    return el;
  }
  if (type === "audio") {
    const base = normalizeBase(raw, "audio");
    base.w = num(base.w, 344, VOICE_MIN_WIDTH, VOICE_MAX_WIDTH);
    base.h = VOICE_HEIGHT;
    const rawPeaks = Array.isArray(raw.peaks) ? raw.peaks : [];
    const peaks = rawPeaks
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map((value) => Math.max(0, Math.min(1, value)))
      .slice(0, 240);
    const el: AudioElement = {
      ...base,
      type: "audio",
      attachment: str(raw.attachment, ""),
      duration: num(raw.duration, 0, 0, 3600),
      peaks: peaks.length ? peaks : [0.08],
      seed: Math.round(num(raw.seed, Math.random() * 1e9)),
      color: str(raw.color, "ink"),
      label: str(raw.label, ""),
      mount: VOICE_MOUNTS.includes(str(raw.mount) as AudioElement["mount"])
        ? (raw.mount as AudioElement["mount"])
        : "tape",
      recordedAt: str(raw.recordedAt, nowIso()),
    };
    return el;
  }
  return null;
}

function normalizeLayers(raw: unknown): LayerState[] {
  const saved = Array.isArray(raw) ? raw.filter(isRecord) : [];
  const used = new Set<LayerId>();
  const layers: LayerState[] = [];
  for (const entry of saved) {
    const id = layerId(entry.id);
    if (used.has(id)) continue;
    used.add(id);
    const fallback = DEFAULT_LAYERS.find((l) => l.id === id) ?? DEFAULT_LAYERS[1];
    layers.push({
      id,
      name: str(entry.name, fallback.name),
      visible: bool(entry.visible, true),
      locked: bool(entry.locked, false),
    });
  }
  for (const fallback of DEFAULT_LAYERS) {
    if (!used.has(fallback.id)) layers.push({ ...fallback });
  }
  return layers;
}

export interface PageDefaults {
  id: string;
  title: string;
  tabId: string;
  number: number;
  background?: PageBackground;
  kind?: PageKind;
}

export function normalizePage(raw: unknown, defaults: PageDefaults): PageData {
  const record = isRecord(raw) ? raw : {};
  const elementsRaw = Array.isArray(record.elements) ? record.elements : [];
  const elements = elementsRaw
    .map(normalizeElement)
    .filter((el): el is PageElement => el !== null);
  const background = BACKGROUNDS.includes(record.background as PageBackground)
    ? (record.background as PageBackground)
    : (defaults.background ?? "plain");
  const kind: PageKind = record.kind === "contents" ? "contents" : (defaults.kind ?? "freeform");
  return {
    version: DATA_VERSION,
    id: str(record.id, defaults.id),
    title: str(record.title, defaults.title),
    number: num(record.number, defaults.number, 0),
    tabId: str(record.tabId, defaults.tabId),
    kind,
    background,
    layers: normalizeLayers(record.layers),
    elements,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function normalizeJournalSettings(raw: unknown): JournalSettings {
  const record = isRecord(raw) ? raw : {};
  const d = DEFAULT_JOURNAL_SETTINGS;
  const brushesRaw = isRecord(record.brushes) ? record.brushes : {};
  const brush = (key: keyof JournalSettings["brushes"], fallback: { color: string; size: number; opacity: number; pressure: boolean; assist: boolean }) => {
    const entry = isRecord(brushesRaw[key]) ? (brushesRaw[key] as Record<string, unknown>) : {};
    return {
      color: str(entry.color, fallback.color),
      size: num(entry.size, fallback.size, 0.5, 120),
      opacity: num(entry.opacity, fallback.opacity, 0.02, 1),
      pressure: bool(entry.pressure, fallback.pressure),
      assist: bool(entry.assist, fallback.assist),
    };
  };
  return {
    theme: THEMES.includes(record.theme as ThemeId) ? (record.theme as ThemeId) : d.theme,
    pageWidth: num(record.pageWidth, d.pageWidth, 500, 4000),
    pageHeight: num(record.pageHeight, d.pageHeight, 500, 6000),
    flipAnimation: bool(record.flipAnimation, d.flipAnimation),
    flipDuration: num(record.flipDuration, d.flipDuration, 120, 2000),
    bookScale: num(record.bookScale, d.bookScale, 0.5, 1),
    autosaveDelay: num(record.autosaveDelay, d.autosaveDelay, 150, 10000),
    titleFont: str(record.titleFont, ""),
    bodyFont: str(record.bodyFont, ""),
    customPaperTexture: str(record.customPaperTexture, ""),
    defaultBackground: BACKGROUNDS.includes(record.defaultBackground as PageBackground)
      ? (record.defaultBackground as PageBackground)
      : d.defaultBackground,
    showPageNumbers: bool(record.showPageNumbers, d.showPageNumbers),
    snapToGrid: bool(record.snapToGrid, d.snapToGrid),
    gridSize: num(record.gridSize, d.gridSize, 4, 200),
    showContents: bool(record.showContents, d.showContents),
    voice: (() => {
      const voice = isRecord(record.voice) ? record.voice : {};
      return {
        color: str(voice.color, d.voice.color),
        mount: VOICE_MOUNTS.includes(voice.mount as AudioElement["mount"])
          ? (voice.mount as AudioElement["mount"])
          : d.voice.mount,
      };
    })(),
    brushes: {
      pen: brush("pen", d.brushes.pen),
      pencil: brush("pencil", d.brushes.pencil),
      marker: brush("marker", d.brushes.marker),
      highlighter: brush("highlighter", d.brushes.highlighter),
      eraserSize: num(brushesRaw.eraserSize, d.brushes.eraserSize, 6, 200),
      activeBrush: ["pen", "pencil", "marker", "highlighter"].includes(str(brushesRaw.activeBrush))
        ? (brushesRaw.activeBrush as JournalSettings["brushes"]["activeBrush"])
        : d.brushes.activeBrush,
      activeColor: str(brushesRaw.activeColor, d.brushes.activeColor),
    },
  };
}

function normalizePageMeta(raw: unknown, tabId: string, title: string): PageMeta {
  const record = isRecord(raw) ? raw : {};
  return {
    id: str(record.id) || uid("page"),
    title: str(record.title, title),
    tabId: str(record.tabId, tabId),
    kind: record.kind === "contents" ? "contents" : "freeform",
    background: BACKGROUNDS.includes(record.background as PageBackground)
      ? (record.background as PageBackground)
      : "plain",
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

export function normalizeJournal(raw: unknown, fallbackTitle = "Fieldbook"): JournalData {
  const record = isRecord(raw) ? raw : {};
  const settings = normalizeJournalSettings(record.settings);
  const tabsRaw = Array.isArray(record.tabs) ? record.tabs.filter(isRecord) : [];
  const pagesRaw = isRecord(record.pages) ? record.pages : {};
  const pages: Record<string, PageMeta> = {};

  for (const [key, value] of Object.entries(pagesRaw)) {
    if (!isRecord(value)) continue;
    const meta = normalizePageMeta({ ...value, id: str(value.id, key) }, "", "Untitled");
    pages[meta.id] = meta;
  }

  const tabs: TabData[] = [];
  const usedPageIds = new Set<string>();
  for (const entry of tabsRaw) {
    const id = str(entry.id) || uid("tab");
    const rawPageIds = Array.isArray(entry.pageIds) ? entry.pageIds : [];
    const pageIds: string[] = [];
    for (const pageIdRaw of rawPageIds) {
      const pageId = str(pageIdRaw);
      if (!pageId || !pages[pageId] || usedPageIds.has(pageId)) continue;
      usedPageIds.add(pageId);
      pages[pageId].tabId = id;
      pageIds.push(pageId);
    }
    tabs.push({
      id,
      name: str(entry.name, `Tab ${tabs.length + 1}`),
      color: TAB_COLORS.includes(entry.color as TabColor) ? (entry.color as TabColor) : "cream",
      icon: str(entry.icon, "bookmark"),
      pageIds,
    });
  }

  const orphans = Object.values(pages).filter((meta) => !usedPageIds.has(meta.id));
  if (orphans.length) {
    if (!tabs.length) {
      tabs.push({
        id: uid("tab"),
        name: "Journal",
        color: "cream",
        icon: "bookmark",
        pageIds: [],
      });
    }
    const targetTab = tabs.find((tab) => tab.id === orphans[0].tabId) ?? tabs[0];
    for (const meta of orphans) {
      meta.tabId = targetTab.id;
      targetTab.pageIds.push(meta.id);
    }
  }

  const trashRaw = Array.isArray(record.trash) ? record.trash : [];
  const trash: TrashedPage[] = [];
  for (const entry of trashRaw) {
    if (!isRecord(entry) || !isRecord(entry.meta)) continue;
    const meta = normalizePageMeta(entry.meta, "", "Untitled");
    if (pages[meta.id]) continue;
    trash.push({
      meta,
      deletedAt: iso(entry.deletedAt),
      previousTabId: str(entry.previousTabId, meta.tabId),
      previousIndex: Math.round(num(entry.previousIndex, 0, 0, 9999)),
    });
  }

  return {
    version: DATA_VERSION,
    id: str(record.id) || uid("journal"),
    title: str(record.title, fallbackTitle),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    settings,
    tabs,
    pages,
    trash,
  };
}
