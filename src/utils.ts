import type {
  DrawingElement,
  DrawingPoint,
  ElementBase,
  PageElement,
  Point,
} from "./types";

export function uid(prefix = "id"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `${prefix}_${rnd}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* falls through for non-cloneable content */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function rotatePoint(point: Point, angleRad: number, origin: Point): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

export function centerOf(el: ElementBase): Point {
  return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
}

export function elementCorners(el: ElementBase): Point[] {
  const c = centerOf(el);
  const rad = degToRad(el.rotation);
  const pts = [
    { x: el.x, y: el.y },
    { x: el.x + el.w, y: el.y },
    { x: el.x + el.w, y: el.y + el.h },
    { x: el.x, y: el.y + el.h },
  ];
  return pts.map((p) => rotatePoint(p, rad, c));
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOfPoints(points: Point[]): Bounds {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBounds(elements: ElementBase[]): Bounds {
  const pts: Point[] = [];
  for (const el of elements) pts.push(...elementCorners(el));
  return boundsOfPoints(pts);
}

export function hitTestElement(el: ElementBase, p: Point, tolerance = 0): boolean {
  const c = centerOf(el);
  const local = rotatePoint(p, -degToRad(el.rotation), c);
  return (
    local.x >= el.x - tolerance &&
    local.x <= el.x + el.w + tolerance &&
    local.y >= el.y - tolerance &&
    local.y <= el.y + el.h + tolerance
  );
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function drawingAbsolutePoints(
  el: DrawingElement,
  scaleX = 1,
  scaleY = 1,
): Point[] {
  return el.points.map((pt) => ({
    x: el.x + pt.x * el.w * scaleX,
    y: el.y + pt.y * el.h * scaleY,
  }));
}

export function hitTestDrawing(el: DrawingElement, p: Point, extra = 0): boolean {
  const c = centerOf(el);
  const local = rotatePoint(p, -degToRad(el.rotation), c);
  if (!hitTestElement(el, local, extra + el.size / 2)) return false;
  const pts = el.points.map((pt) => ({
    x: el.x + pt.x * el.w,
    y: el.y + pt.y * el.h,
  }));
  const threshold = el.size / 2 + extra + 2;
  if (pts.length === 1) return Math.hypot(pts[0].x - local.x, pts[0].y - local.y) <= threshold;
  for (let i = 1; i < pts.length; i++) {
    if (distanceToSegment(local, pts[i - 1], pts[i]) <= threshold) return true;
  }
  return false;
}

export function hitTestElementDeep(el: PageElement, p: Point): boolean {
  if (el.type === "drawing") return hitTestDrawing(el, p, 6);
  if (el.type === "shape" && (el.shape === "line" || el.shape === "arrow")) {
    const c = centerOf(el);
    const local = rotatePoint(p, -degToRad(el.rotation), c);
    const a = el.points[0] ?? { x: 0, y: 0 };
    const b = el.points[1] ?? { x: 1, y: 1 };
    const p1 = { x: el.x + a.x * el.w, y: el.y + a.y * el.h };
    const p2 = { x: el.x + b.x * el.w, y: el.y + b.y * el.h };
    return distanceToSegment(local, p1, p2) <= Math.max(10, el.strokeWidth * 1.5);
  }
  return hitTestElement(el, p);
}

export function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

export function normalizeRect(start: Point, end: Point): Bounds {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { x, y, w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}

export function snapValue(value: number, targets: number[], threshold: number): { value: number; hit: number | null } {
  let best: number | null = null;
  let dist = threshold;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= dist) {
      dist = d;
      best = t;
    }
  }
  return best === null ? { value, hit: null } : { value: best, hit: best };
}

export function sanitizeFilename(name: string, fallback = "page"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Layout-independent key identity: "KeyV" is always "v", no matter whether the
 * user types on a QWERTY, ЙЦУКЕН or Dvorak layout.
 */
export function physicalKey(event: KeyboardEvent): string {
  const code = event.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return (event.key ?? "").toLowerCase();
}

export function isTypingTarget(target: EventTarget | null): boolean {  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.closest(".cm-editor") !== null
  );
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function parseWikiLink(raw: string): { target: string; alias: string } | null {
  const match = raw.trim().match(/^!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (!match) return null;
  return { target: match[1].trim(), alias: (match[2] ?? match[1]).trim() };
}

export function splitWikiLinks(text: string): { plain: string; links: string[] } {
  const links: string[] = [];
  const plain = text.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => {
    const display = (alias ?? target).split("/").pop() ?? target;
    links.push(target.trim());
    return display;
  });
  return { plain, links };
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function resolveCssColor(color: string, host: HTMLElement): string {
  if (!color) return "#222";
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  const vars: Record<string, string> = {
    ink: "--fb-ink",
    "ink-soft": "--fb-ink-soft",
    accent: "--fb-accent",
    muted: "--fb-rule",
  };
  const varName = vars[color] ?? color;
  const value = getComputedStyle(host).getPropertyValue(varName).trim();
  return value || "#222";
}

export function nextZ(elements: PageElement[]): number {
  let z = 0;
  for (const el of elements) z = Math.max(z, el.z);
  return z + 1;
}

export function moveItem<T>(arr: T[], from: number, to: number): void {
  if (from < 0 || from >= arr.length) return;
  const [item] = arr.splice(from, 1);
  arr.splice(clamp(to, 0, arr.length), 0, item);
}

export function applyToPoints(
  points: DrawingPoint[],
  transform: (pt: Point) => Point,
): DrawingPoint[] {
  return points.map((pt) => {
    const next = transform({ x: pt.x, y: pt.y });
    return { ...pt, x: next.x, y: next.y };
  });
}

export function formatSpreadRange(left: number, right: number): string {
  return `${left}\u2013${right}`;
}
