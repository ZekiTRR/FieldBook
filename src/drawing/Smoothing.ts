import type { BrushKind } from "../types";

export interface RawPoint {
  x: number;
  y: number;
  p: number;
  tilt?: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Lightweight one-euro style filter: removes sensor jitter without adding
 * perceivable lag to the pen tip.
 */
export function smoothPoint(previous: RawPoint | null, next: RawPoint, strength = 0.42): RawPoint {
  if (!previous) return next;
  return {
    x: previous.x + (next.x - previous.x) * (1 - strength),
    y: previous.y + (next.y - previous.y) * (1 - strength),
    p: previous.p + (next.p - previous.p) * 0.32,
    ...(next.tilt !== undefined ? { tilt: next.tilt } : previous.tilt !== undefined ? { tilt: previous.tilt } : {}),
  };
}

function catmull(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function densifyStroke(points: RawPoint[], spacing = 1.35): RawPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  const output: RawPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(2, Math.min(48, Math.ceil(distance / spacing)));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      output.push({
        x: catmull(p0.x, p1.x, p2.x, p3.x, t),
        y: catmull(p0.y, p1.y, p2.y, p3.y, t),
        p: clamp01(p1.p + (p2.p - p1.p) * t),
        ...(p1.tilt !== undefined ? { tilt: p1.tilt } : {}),
      });
    }
  }
  output.push(points[points.length - 1]);
  return output;
}

function perpendicularDistance(point: RawPoint, start: RawPoint, end: RawPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Ramer–Douglas–Peucker, with pressure carried by whichever points survive. */
export function simplifyStroke(points: RawPoint[], tolerance = 0.42): RawPoint[] {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [first, last];
  const left = simplifyStroke(points.slice(0, index + 1), tolerance);
  const right = simplifyStroke(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

export function widthForPressure(brush: BrushKind, size: number, pressure: number, tilt?: number): number {
  if (brush === "marker" || brush === "highlighter") return size;
  const shaped = brush === "pencil" ? Math.pow(clamp01(pressure), 0.7) : Math.pow(clamp01(pressure), 0.62);
  const minRatio = brush === "pencil" ? 0.38 : 0.22;
  const tiltGain = brush === "pencil" && tilt ? 1 + Math.min(0.55, Math.abs(tilt) * 0.9) : 1;
  return Math.max(0.4, size * (minRatio + (1 - minRatio) * shaped) * tiltGain);
}

export function brushAlpha(brush: BrushKind, opacity: number): number {
  switch (brush) {
    case "pencil":
      return opacity * 0.62;
    case "marker":
      return opacity * 0.82;
    case "highlighter":
      return opacity * 0.72;
    default:
      return opacity;
  }
}

export function isWetBrush(brush: BrushKind): boolean {
  return brush === "marker" || brush === "highlighter";
}
