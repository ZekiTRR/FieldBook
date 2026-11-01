export const VIEW_TYPE = "fieldbook-view";
export const DATA_VERSION = 1;
export const VIRTUAL_W = 1000;
export const VIRTUAL_H = 1414;

export type ThemeId =
  | "classic"
  | "manuscript"
  | "clean"
  | "dark"
  | "field";

export type PageBackground = "plain" | "ruled" | "grid" | "dots";
export type PageKind = "freeform" | "contents";
export type Side = "left" | "right";

export type TabColor =
  | "cream"
  | "ocean"
  | "sage"
  | "rust"
  | "plum"
  | "gold"
  | "charcoal"
  | "rose";

export type ElementType = "text" | "image" | "shape" | "decoration" | "drawing" | "audio";
export type LayerId = "background" | "content" | "drawings" | "decorations";
export type FontChoice = "body" | "title" | "serif" | "mono";
export type BrushKind = "pen" | "pencil" | "marker" | "highlighter";
export type DrawTool = BrushKind | "eraser";
export type ActiveTool = "select" | "text" | "draw" | "shape" | "decorate" | "audio";
export type ShapeKind = "line" | "arrow" | "rect" | "ellipse" | "polygon";
export type VoiceMount = "tape" | "corners" | "none";
export type DecorKind =
  | "tape"
  | "glue"
  | "sticker"
  | "bookmark"
  | "frame"
  | "marker"
  | "photoCorner";

export type SoundCategory = "page" | "tabs" | "writing" | "objects" | "ui";

export interface BrushSettings {
  color: string;
  size: number;
  opacity: number;
  pressure: boolean;
  assist: boolean;
}

export interface CustomSounds {
  page: string;
  tabs: string;
  writing: string;
  objects: string;
  ui: string;
}

export interface PluginSettings {
  dataFolder: string;
  attachmentsFolder: string;
  exportsFolder: string;
  soundEnabled: boolean;
  typingSoundEnabled: boolean;
  masterVolume: number;
  soundVolumes: Record<SoundCategory, number>;
  customSounds: CustomSounds;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  dataFolder: "Fieldbook",
  attachmentsFolder: "attachments",
  exportsFolder: "exports",
  soundEnabled: false,
  typingSoundEnabled: true,
  masterVolume: 0.7,
  soundVolumes: { page: 0.7, tabs: 0.5, writing: 0.35, objects: 0.5, ui: 0.4 },
  customSounds: { page: "", tabs: "", writing: "", objects: "", ui: "" },
};

export interface VoiceDefaults {
  color: string;
  mount: VoiceMount;
}

export interface JournalSettings {
  theme: ThemeId;
  pageWidth: number;
  pageHeight: number;
  flipAnimation: boolean;
  flipDuration: number;
  bookScale: number;
  autosaveDelay: number;
  titleFont: string;
  bodyFont: string;
  customPaperTexture: string;
  defaultBackground: PageBackground;
  showPageNumbers: boolean;
  snapToGrid: boolean;
  gridSize: number;
  showContents: boolean;
  voice: VoiceDefaults;
  brushes: {
    pen: BrushSettings;
    pencil: BrushSettings;
    marker: BrushSettings;
    highlighter: BrushSettings;
    eraserSize: number;
    activeBrush: BrushKind;
    activeColor: string;
  };
}

export const DEFAULT_JOURNAL_SETTINGS: JournalSettings = {
  theme: "classic",
  pageWidth: VIRTUAL_W,
  pageHeight: VIRTUAL_H,
  flipAnimation: true,
  flipDuration: 620,
  bookScale: 1,
  autosaveDelay: 800,
  titleFont: "",
  bodyFont: "",
  customPaperTexture: "",
  defaultBackground: "plain",
  showPageNumbers: true,
  snapToGrid: false,
  gridSize: 20,
  showContents: true,
  voice: { color: "ink", mount: "tape" },
  brushes: {
    pen: { color: "#26303b", size: 3.2, opacity: 1, pressure: true, assist: true },
    pencil: { color: "#4a4740", size: 3.6, opacity: 0.78, pressure: true, assist: true },
    marker: { color: "#a24b34", size: 12, opacity: 0.55, pressure: false, assist: true },
    highlighter: { color: "#e8c54c", size: 28, opacity: 0.28, pressure: false, assist: true },
    eraserSize: 34,
    activeBrush: "pen",
    activeColor: "#26303b",
  },
};

export interface TabData {
  id: string;
  name: string;
  color: TabColor;
  icon: string;
  pageIds: string[];
}

export interface PageMeta {
  id: string;
  title: string;
  tabId: string;
  kind: PageKind;
  background: PageBackground;
  createdAt: string;
  updatedAt: string;
}

export interface TrashedPage {
  meta: PageMeta;
  deletedAt: string;
  previousTabId: string;
  previousIndex: number;
}

export interface JournalData {
  version: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  settings: JournalSettings;
  tabs: TabData[];
  pages: Record<string, PageMeta>;
  trash: TrashedPage[];
}

export interface LayerState {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
}

export const DEFAULT_LAYERS: LayerState[] = [
  { id: "background", name: "Background", visible: true, locked: false },
  { id: "content", name: "Content", visible: true, locked: false },
  { id: "drawings", name: "Ink", visible: true, locked: false },
  { id: "decorations", name: "Decorations", visible: true, locked: false },
];

export interface Point {
  x: number;
  y: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElementBase {
  id: string;
  type: ElementType;
  layer: LayerId;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  opacity: number;
  locked: boolean;
  pinned: boolean;
  groupId: string | null;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  fontFamily: FontChoice;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: "left" | "center" | "right";
  lineHeight: number;
  link: string;
}

export interface ImageElement extends ElementBase {
  type: "image";
  attachment: string;
  naturalW: number;
  naturalH: number;
  crop: CropRect;
  border: boolean;
  shadow: boolean;
  radius: number;
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: ShapeKind;
  stroke: string;
  fill: string;
  strokeWidth: number;
  points: Point[];
  sides: number;
  dashed: boolean;
}

export interface DecorationElement extends ElementBase {
  type: "decoration";
  decor: DecorKind;
  color: string;
  variant: number;
  attachTo: string | null;
}

export interface DrawingPoint {
  x: number;
  y: number;
  p: number;
  tilt?: number;
}

export interface DrawingElement extends ElementBase {
  type: "drawing";
  brush: BrushKind;
  color: string;
  size: number;
  sampleOpacity: number;
  points: DrawingPoint[];
  seed: number;
  baseW: number;
  baseH: number;
}

export interface AudioElement extends ElementBase {
  type: "audio";
  attachment: string;
  duration: number;
  peaks: number[];
  seed: number;
  color: string;
  label: string;
  mount: VoiceMount;
  recordedAt: string;
}

export type PageElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | DecorationElement
  | DrawingElement
  | AudioElement;

export interface PageData {
  version: number;
  id: string;
  title: string;
  number: number;
  tabId: string;
  kind: PageKind;
  background: PageBackground;
  layers: LayerState[];
  elements: PageElement[];
  createdAt: string;
  updatedAt: string;
}

export interface SpreadSlot {
  pageId: string | null;
  number: number;
  tabId: string;
  side: Side;
}

export interface Spread {
  index: number;
  tabId: string;
  left: SpreadSlot;
  right: SpreadSlot;
}

export interface TocEntry {
  number: number;
  title: string;
  tabId: string;
  tabName: string;
  spreadIndex: number;
  pageId: string;
}

export interface BrushPreset {
  id: BrushKind;
  label: string;
  hint: string;
}

export const BRUSH_PRESETS: BrushPreset[] = [
  { id: "pen", label: "Pen", hint: "Ink" },
  { id: "pencil", label: "Pencil", hint: "Graphite" },
  { id: "marker", label: "Marker", hint: "Bold ink" },
  { id: "highlighter", label: "Highlighter", hint: "Soft wash" },
];

export const FONT_OPTIONS: { id: FontChoice; label: string }[] = [
  { id: "title", label: "Handwriting" },
  { id: "body", label: "Journal" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Typewriter" },
];

export const TAB_COLOR_OPTIONS: TabColor[] = [
  "cream",
  "ocean",
  "sage",
  "rust",
  "plum",
  "gold",
  "charcoal",
  "rose",
];

export interface FieldbookSettingsSchema {
  settings: PluginSettings;
}

export interface ClipboardPayload {
  elements: PageElement[];
  sourcePageId: string;
}
