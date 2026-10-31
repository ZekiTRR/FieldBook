import type { BrushKind } from "../types";
import type { RawPoint } from "./Smoothing";

export type AssistKind = "line" | "ellipse" | "rect";

export interface AssistResult {
  kind: AssistKind;
  points: RawPoint[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Strokes smaller than this stay untouched, so dots and ticks keep their feel. */
const MIN_SPAN = 34;
const ANGLE_SNAP_DEG = 15;
const ANGLE_SNAP_TOLERANCE = 3.5;

/**
 * Snaps a confident freehand stroke to a straight line, an ellipse or a
 * rectangle. Deliberately conservative: anything that is not clearly one of
 * those shapes is returned untouched.
 */
export function assistStroke(points: RawPoint[], brush: BrushKind | "eraser"): AssistResult | null {
  if (points.length < 3 || brush === "eraser") return null;
  const box = boundsOf(points);
  if (Math.max(box.w, box.h) < MIN_SPAN) return null;
  const line = straightLine(points);
  if (line) return line;
  return isClosed(points, box) ? snapClosedShape(points, box) : null;
}

function boundsOf(points: RawPoint[]): Box {
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

function pathLength(points: RawPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function perpendicularDistance(p: RawPoint, a: RawPoint, b: RawPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

function straightLine(points: RawPoint[]): AssistResult | null {
  const first = points[0];
  const last = points[points.length - 1];
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  if (chord < MIN_SPAN) return null;
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) {
    worst = Math.max(worst, perpendicularDistance(points[i], first, last));
  }
  if (worst > Math.min(22, Math.max(7, chord * 0.08))) return null;
  if (pathLength(points) > chord * 1.22) return null;
  const end = snapAngle(first, last);
  return {
    kind: "line",
    points: [
      { x: first.x, y: first.y, p: 1 },
      { x: end.x, y: end.y, p: 1 },
    ],
  };
}

/** The endpoint moved to the closest tidy angle. */
function snapAngle(from: RawPoint, to: RawPoint): RawPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return from;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const target = Math.round(angle / ANGLE_SNAP_DEG) * ANGLE_SNAP_DEG;
  let delta = Math.abs(angle - target);
  if (delta > 180) delta = 360 - delta;
  if (delta > ANGLE_SNAP_TOLERANCE) return from;
  const radians = (target * Math.PI) / 180;
  return { ...from, x: from.x + Math.cos(radians) * length, y: from.y + Math.sin(radians) * length };
}

function isClosed(points: RawPoint[], box: Box): boolean {
  const span = Math.max(box.w, box.h);
  const gap = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].y - points[0].y,
  );
  return gap <= span * 0.3;
}

function distanceToRectOutline(p: RawPoint, box: Box): number {
  const outsideX = Math.max(box.x - p.x, 0, p.x - (box.x + box.w));
  const outsideY = Math.max(box.y - p.y, 0, p.y - (box.y + box.h));
  if (outsideX > 0 || outsideY > 0) return Math.hypot(outsideX, outsideY);
  return Math.min(p.x - box.x, box.x + box.w - p.x, p.y - box.y, box.y + box.h - p.y);
}

interface Candidate extends AssistResult {
  /** Mean distance from the stroke to the ideal shape, relative to the shape size. */
  error: number;
}

/** A circle and a rounded box both fit; the tighter one wins. */
function snapClosedShape(points: RawPoint[], box: Box): AssistResult | null {
  const rect = rectCandidate(points, box);
  const ellipse = ellipseCandidate(points, box);
  if (rect && ellipse) return rect.error <= ellipse.error ? rect : ellipse;
  return rect ?? ellipse;
}

function rectCandidate(points: RawPoint[], box: Box): Candidate | null {
  if (box.w < MIN_SPAN || box.h < MIN_SPAN) return null;
  let total = 0;
  for (const p of points) total += distanceToRectOutline(p, box);
  const error = total / points.length / (Math.min(box.w, box.h) / 2);
  if (error > 0.16) return null;

  const corners: Array<[number, number]> = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
  const reach = Math.max(box.w, box.h) * 0.3;
  for (const corner of corners) {
    const visited = points.some((p) => Math.hypot(p.x - corner[0], p.y - corner[1]) <= reach);
    if (!visited) return null;
  }

  const perimeter = 2 * (box.w + box.h);
  const length = pathLength(points);
  if (length < perimeter * 0.7 || length > perimeter * 1.95) return null;

  let start = 0;
  let bestDistance = Infinity;
  corners.forEach((corner, index) => {
    const distance = Math.hypot(points[0].x - corner[0], points[0].y - corner[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      start = index;
    }
  });
  const probe = points[Math.min(points.length - 1, 6)];
  const clockwise =
    Math.hypot(probe.x - corners[(start + 1) % 4][0], probe.y - corners[(start + 1) % 4][1]) <=
    Math.hypot(probe.x - corners[(start + 3) % 4][0], probe.y - corners[(start + 3) % 4][1]);
  const order: RawPoint[] = [];
  for (let step = 0; step <= 4; step++) {
    const corner = corners[(start + (clockwise ? step : (4 - step) % 4)) % 4];
    order.push({ x: corner[0], y: corner[1], p: 1 });
  }
  return { kind: "rect", points: order, error };
}

function ellipseCandidate(points: RawPoint[], box: Box): Candidate | null {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2;
  const ry = box.h / 2;
  if (rx < MIN_SPAN / 2 || ry < MIN_SPAN / 2) return null;
  const aspect = rx / ry;
  if (aspect > 2.4 || aspect < 0.42) return null;

  const angles: number[] = [];
  let total = 0;
  let worst = 0;
  for (const p of points) {
    const dx = (p.x - cx) / rx;
    const dy = (p.y - cy) / ry;
    const deviation = Math.abs(Math.hypot(dx, dy) - 1);
    total += deviation;
    worst = Math.max(worst, deviation);
    angles.push(Math.atan2(dy, dx));
  }
  const error = total / points.length;
  if (error > 0.22 || worst > 0.45) return null;
  if (!coversCircle(angles)) return null;

  const start = angles[0];
  const probe = angles[Math.min(angles.length - 1, 8)];
  let delta = probe - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const direction = delta < 0 ? -1 : 1;

  const samples = 72;
  const outline: RawPoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = start + direction * (i / samples) * Math.PI * 2;
    outline.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry, p: 1 });
  }
  return { kind: "ellipse", points: outline, error };
}

function coversCircle(angles: number[]): boolean {
  const sorted = [...angles].sort((a, b) => a - b);
  let widest = sorted[0] + Math.PI * 2 - sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i++) {
    widest = Math.max(widest, sorted[i] - sorted[i - 1]);
  }
  return widest < 0.95;
}
