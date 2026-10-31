import type { BrushKind, DrawingElement, Point } from "../types";
import { seededRandom } from "../utils";
import {
  brushAlpha,
  densifyStroke,
  isWetBrush,
  widthForPressure,
  type RawPoint,
} from "./Smoothing";

export interface DrawStyle {
  brush: BrushKind;
  color: string;
  size: number;
  opacity: number;
  seed: number;
  pressureEnabled: boolean;
  darkPaper: boolean;
}

interface WeightedPoint extends RawPoint {
  weight: number;
}

function weightedSamples(points: RawPoint[], style: DrawStyle): WeightedPoint[] {
  const dense = densifyStroke(points, style.brush === "highlighter" ? 2.4 : 1.5);
  return dense.map((point) => {
    const pressure = style.pressureEnabled ? point.p : 1;
    return {
      ...point,
      weight: widthForPressure(style.brush, style.size, pressure, point.tilt),
    };
  });
}

function smoothWeights(points: WeightedPoint[]): void {
  for (let i = 1; i < points.length; i++) {
    points[i].weight = points[i - 1].weight * 0.72 + points[i].weight * 0.28;
  }
  for (let i = points.length - 2; i >= 0; i--) {
    points[i].weight = points[i + 1].weight * 0.55 + points[i].weight * 0.45;
  }
}

function strokeOutline(points: WeightedPoint[]): Point[] | null {
  const filtered: WeightedPoint[] = [];
  for (const point of points) {
    const prev = filtered[filtered.length - 1];
    if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 0.05) filtered.push(point);
  }
  if (!filtered.length) return null;
  if (filtered.length === 1) {
    const p = filtered[0];
    const r = Math.max(0.35, p.weight / 2);
    return [
      { x: p.x - r, y: p.y },
      { x: p.x + r, y: p.y },
      { x: p.x, y: p.y + r },
      { x: p.x, y: p.y - r },
    ];
  }
  const left: Point[] = [];
  const right: Point[] = [];
  const normals: Point[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const prev = filtered[Math.max(0, i - 1)];
    const next = filtered[Math.min(filtered.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    normals.push({ x: nx, y: ny });
    const half = Math.max(0.2, filtered[i].weight / 2);
    left.push({ x: filtered[i].x + nx * half, y: filtered[i].y + ny * half });
    right.push({ x: filtered[i].x - nx * half, y: filtered[i].y - ny * half });
  }
  const polygon: Point[] = [...left];
  const last = filtered[filtered.length - 1];
  const lastRadius = Math.max(0.2, last.weight / 2);
  const endAngle = Math.atan2(normals[normals.length - 1].y, normals[normals.length - 1].x);
  const capSteps = 8;
  for (let i = 1; i <= capSteps; i++) {
    const angle = endAngle - (Math.PI * i) / capSteps;
    polygon.push({ x: last.x + Math.cos(angle) * lastRadius, y: last.y + Math.sin(angle) * lastRadius });
  }
  for (let i = right.length - 1; i >= 0; i--) polygon.push(right[i]);
  const first = filtered[0];
  const firstRadius = Math.max(0.2, first.weight / 2);
  const startAngle = Math.atan2(-normals[0].y, -normals[0].x);
  for (let i = 1; i <= capSteps; i++) {
    const angle = startAngle - (Math.PI * i) / capSteps;
    polygon.push({ x: first.x + Math.cos(angle) * firstRadius, y: first.y + Math.sin(angle) * firstRadius });
  }
  return polygon;
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function drawPencilGrain(
  ctx: CanvasRenderingContext2D,
  points: WeightedPoint[],
  style: DrawStyle,
): void {
  const random = seededRandom(style.seed || 1);
  const count = Math.min(1400, Math.max(10, Math.floor(points.length / 3)));
  const baseAlpha = ctx.globalAlpha;
  ctx.fillStyle = style.color;
  for (let i = 0; i < count; i++) {
    const sample = points[Math.floor(random() * points.length)];
    if (!sample) continue;
    const radius = Math.max(0.15, sample.weight / 2);
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius * 0.92;
    const x = sample.x + Math.cos(angle) * distance;
    const y = sample.y + Math.sin(angle) * distance;
    ctx.globalAlpha = baseAlpha * (0.08 + random() * 0.2);
    ctx.beginPath();
    ctx.arc(x, y, 0.25 + random() * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: RawPoint[],
  style: DrawStyle,
): void {
  if (!points.length) return;
  const dense = weightedSamples(points, style);
  smoothWeights(dense);
  const outline = strokeOutline(dense);
  if (!outline) return;
  const alpha = brushAlpha(style.brush, style.opacity);
  const wet = isWetBrush(style.brush);
  ctx.save();
  ctx.globalCompositeOperation = wet && !style.darkPaper ? "multiply" : "source-over";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style.color;
  tracePolygon(ctx, outline);
  ctx.fill();
  if (style.brush === "pencil") {
    drawPencilGrain(ctx, dense, style);
  }
  if (style.brush === "pen" || style.brush === "marker") {
    const random = seededRandom((style.seed || 7) + 13);
    const baseAlpha = ctx.globalAlpha;
    ctx.globalAlpha = baseAlpha * 0.18;
    for (let i = 0; i < Math.min(60, dense.length); i += 7) {
      const sample = dense[i];
      if (!sample) continue;
      ctx.beginPath();
      ctx.arc(sample.x + (random() - 0.5) * 0.6, sample.y + (random() - 0.5) * 0.6, 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = baseAlpha;
  }
  ctx.restore();
}

export function renderDrawingElement(
  ctx: CanvasRenderingContext2D,
  el: DrawingElement,
  resolveColor: (value: string) => string,
  darkPaper: boolean,
): void {
  if (!el.points.length) return;
  const baseW = el.baseW > 0 ? el.baseW : el.w;
  const baseH = el.baseH > 0 ? el.baseH : el.h;
  const factor = Math.sqrt(Math.max(0.05, (el.w / Math.max(1, baseW)) * (el.h / Math.max(1, baseH))));
  const points: RawPoint[] = el.points.map((pt) => ({
    x: pt.x * el.w,
    y: pt.y * el.h,
    p: pt.p,
    ...(pt.tilt !== undefined ? { tilt: pt.tilt } : {}),
  }));
  ctx.save();
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.w / 2, -el.h / 2);
  drawStroke(ctx, points, {
    brush: el.brush,
    color: resolveColor(el.color),
    size: el.size * factor,
    opacity: el.sampleOpacity,
    seed: el.seed,
    pressureEnabled: el.brush === "pen" || el.brush === "pencil",
    darkPaper,
  });
  ctx.restore();
}

export function drawEraserCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  inkColor: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = inkColor;
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  ctx.restore();
}
