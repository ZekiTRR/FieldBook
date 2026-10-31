import type {
  Bounds,
} from "../utils";
import {
  boundsOfPoints,
  nowIso,
  uid,
} from "../utils";
import type {
  BrushSettings,
  DecorationElement,
  DrawingElement,
  DrawingPoint,
  ElementBase,
  ImageElement,
  PageElement,
  Point,
  ShapeElement,
  ShapeKind,
  TextElement,
} from "../types";

const BASE: Omit<ElementBase, "id" | "type" | "layer" | "x" | "y" | "w" | "h" | "z"> = {
  rotation: 0,
  opacity: 1,
  locked: false,
  pinned: false,
  groupId: null,
};

export interface NewElementOptions {
  layer?: ElementBase["layer"];
  rotation?: number;
  opacity?: number;
  z?: number;
}

export function createTextElement(
  x: number,
  y: number,
  options: Partial<TextElement> & NewElementOptions = {},
): TextElement {
  return {
    ...BASE,
    id: uid("el"),
    type: "text",
    layer: options.layer ?? "content",
    x,
    y,
    w: options.w ?? 380,
    h: options.h ?? 96,
    z: options.z ?? 1,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    text: options.text ?? "",
    fontFamily: options.fontFamily ?? "body",
    fontSize: options.fontSize ?? 28,
    color: options.color ?? "ink",
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    underline: options.underline ?? false,
    align: options.align ?? "left",
    lineHeight: options.lineHeight ?? 1.38,
    link: options.link ?? "",
  };
}

export function createImageElement(
  attachment: string,
  naturalW: number,
  naturalH: number,
  x: number,
  y: number,
  options: Partial<ImageElement> & NewElementOptions = {},
): ImageElement {
  const ratio = naturalW > 0 && naturalH > 0 ? naturalH / naturalW : 0.75;
  const width = options.w ?? 420;
  return {
    ...BASE,
    id: uid("el"),
    type: "image",
    layer: options.layer ?? "content",
    x,
    y,
    w: width,
    h: options.h ?? Math.max(80, Math.min(900, width * ratio)),
    z: options.z ?? 1,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    attachment,
    naturalW,
    naturalH,
    crop: options.crop ?? { x: 0, y: 0, w: 1, h: 1 },
    border: options.border ?? true,
    shadow: options.shadow ?? true,
    radius: options.radius ?? 2,
  };
}

export function createShapeElement(
  shape: ShapeKind,
  bounds: Bounds,
  points: Point[],
  options: Partial<ShapeElement> & NewElementOptions = {},
): ShapeElement {
  return {
    ...BASE,
    id: uid("el"),
    type: "shape",
    layer: options.layer ?? "content",
    x: bounds.x,
    y: bounds.y,
    w: Math.max(6, bounds.w),
    h: Math.max(6, bounds.h),
    z: options.z ?? 1,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    shape,
    stroke: options.stroke ?? "ink",
    fill: options.fill ?? "none",
    strokeWidth: options.strokeWidth ?? 3,
    points,
    sides: options.sides ?? 5,
    dashed: options.dashed ?? false,
  };
}

export function createDecorationElement(
  decor: DecorationElement["decor"],
  x: number,
  y: number,
  options: Partial<DecorationElement> & NewElementOptions = {},
): DecorationElement {
  const defaults: Record<DecorationElement["decor"], { w: number; h: number }> = {
    tape: { w: 220, h: 42 },
    glue: { w: 130, h: 96 },
    sticker: { w: 112, h: 112 },
    bookmark: { w: 64, h: 172 },
    frame: { w: 420, h: 320 },
    marker: { w: 280, h: 54 },
    photoCorner: { w: 120, h: 120 },
  };
  const size = defaults[decor];
  return {
    ...BASE,
    id: uid("el"),
    type: "decoration",
    layer: options.layer ?? "decorations",
    x,
    y,
    w: options.w ?? size.w,
    h: options.h ?? size.h,
    z: options.z ?? 1,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
    decor,
    color: options.color ?? "accent",
    variant: options.variant ?? Math.floor(Math.random() * 3),
    attachTo: options.attachTo ?? null,
  };
}

export interface DrawingCreation {
  brush: DrawingElement["brush"];
  settings: Pick<BrushSettings, "color" | "size" | "opacity" | "pressure">;
  points: { x: number; y: number; p: number; tilt?: number }[];
}

export function createDrawingElement(data: DrawingCreation, z = 1): DrawingElement | null {
  if (data.points.length < 1) return null;
  const bounds = boundsOfPoints(data.points);
  const pad = Math.max(2, data.settings.size * 0.9);
  const x = bounds.x - pad;
  const y = bounds.y - pad;
  const w = Math.max(2, bounds.w + pad * 2);
  const h = Math.max(2, bounds.h + pad * 2);
  const points: DrawingPoint[] = data.points.map((pt) => ({
    x: (pt.x - x) / w,
    y: (pt.y - y) / h,
    p: Math.max(0, Math.min(1, pt.p)),
    ...(pt.tilt !== undefined ? { tilt: pt.tilt } : {}),
  }));
  return {
    ...BASE,
    id: uid("el"),
    type: "drawing",
    layer: "drawings",
    x,
    y,
    w,
    h,
    z,
    rotation: 0,
    opacity: 1,
    brush: data.brush,
    color: data.settings.color,
    size: data.settings.size,
    sampleOpacity: data.settings.opacity,
    points,
    seed: Math.floor(Math.random() * 1e9),
    baseW: w,
    baseH: h,
  };
}

export function createTapeForImage(
  image: ImageElement,
  slot: number,
  color = "cream",
): DecorationElement {
  const width = Math.min(230, Math.max(110, image.w * 0.42));
  const height = Math.max(30, Math.min(52, image.h * 0.09));
  const positions = [
    { x: image.x + image.w * 0.12, y: image.y - height * 0.32, rotation: -7 },
    { x: image.x + image.w * 0.58, y: image.y + image.h - height * 0.68, rotation: 5 },
    { x: image.x - width * 0.16, y: image.y + image.h * 0.16, rotation: 78 },
    { x: image.x + image.w - width * 0.84, y: image.y + image.h * 0.7, rotation: -72 },
  ];
  const pos = positions[slot % positions.length];
  return createDecorationElement("tape", pos.x, pos.y, {
    w: width,
    h: height,
    rotation: image.rotation + pos.rotation,
    color,
    attachTo: image.id,
    layer: "decorations",
  });
}

export function cloneElements(
  elements: PageElement[],
  offset: number,
  freshIds = true,
): PageElement[] {
  const groupMap = new Map<string, string>();
  return elements.map((el) => {
    const clone = JSON.parse(JSON.stringify(el)) as PageElement;
    if (freshIds) clone.id = uid("el");
    clone.x += offset;
    clone.y += offset;
    if (el.groupId) {
      if (!groupMap.has(el.groupId)) groupMap.set(el.groupId, uid("group"));
      clone.groupId = groupMap.get(el.groupId) ?? null;
    }
    if (clone.type === "decoration" && clone.attachTo) {
      const attachedSource = elements.find((candidate) => candidate.id === clone.attachTo);
      if (attachedSource) {
        const index = elements.indexOf(attachedSource);
        const target = elements[index];
        if (target && target !== el) clone.attachTo = null;
      }
    }
    return clone;
  });
}

export function elementTimestamp(): string {
  return nowIso();
}
