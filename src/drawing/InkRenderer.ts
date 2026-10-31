import type { BrushKind, DrawingElement, LayerId } from "../types";
import { drawEraserCursor, drawStroke, renderDrawingElement } from "./BrushRenderer";
import type { RawPoint } from "./Smoothing";

interface InkCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export class InkRenderer {
  private layers = new Map<LayerId, InkCanvas>();
  private live: InkCanvas | null = null;
  private pageWidth = 1000;
  private pageHeight = 1414;
  private scale = 1;
  private dpr = 1;
  private darkPaper = false;
  private resolveColor: (value: string) => string = (v) => v;

  setContext(options: {
    pageWidth: number;
    pageHeight: number;
    scale: number;
    dpr: number;
    darkPaper: boolean;
    resolveColor: (value: string) => string;
  }): void {
    this.pageWidth = options.pageWidth;
    this.pageHeight = options.pageHeight;
    this.dpr = Math.min(2.5, Math.max(1, options.dpr));
    this.darkPaper = options.darkPaper;
    this.resolveColor = options.resolveColor;
    this.scale = options.scale;
    for (const entry of this.layers.values()) this.prepare(entry);
    if (this.live) this.prepare(this.live);
  }

  setLayerCanvas(layerId: LayerId, canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const entry = { canvas, ctx };
    this.layers.set(layerId, entry);
    this.prepare(entry);
  }

  setLiveCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    this.live = { canvas, ctx };
    this.prepare(this.live);
  }

  private prepare(entry: InkCanvas): void {
    const ratio = this.scale * this.dpr;
    const width = Math.max(1, Math.round(this.pageWidth * ratio));
    const height = Math.max(1, Math.round(this.pageHeight * ratio));
    if (entry.canvas.width !== width || entry.canvas.height !== height) {
      entry.canvas.width = width;
      entry.canvas.height = height;
    }
    entry.canvas.style.width = `${this.pageWidth}px`;
    entry.canvas.style.height = `${this.pageHeight}px`;
    entry.ctx.setTransform(width / this.pageWidth, 0, 0, height / this.pageHeight, 0, 0);
  }

  resize(scale: number, dpr: number): boolean {
    const nextDpr = Math.min(2.5, Math.max(1, dpr));
    const changed = scale !== this.scale || nextDpr !== this.dpr;
    this.scale = scale;
    this.dpr = nextDpr;
    for (const entry of this.layers.values()) this.prepare(entry);
    if (this.live) this.prepare(this.live);
    return changed;
  }

  redrawAll(elements: DrawingElement[]): void {
    const byLayer = new Map<LayerId, DrawingElement[]>();
    for (const el of elements) {
      if (el.type !== "drawing") continue;
      const list = byLayer.get(el.layer) ?? [];
      list.push(el);
      byLayer.set(el.layer, list);
    }
    for (const [layerId, entry] of this.layers) {
      entry.ctx.clearRect(0, 0, this.pageWidth, this.pageHeight);
      const drawings = (byLayer.get(layerId) ?? []).sort((a, b) => a.z - b.z);
      for (const el of drawings) {
        renderDrawingElement(entry.ctx, el, this.resolveColor, this.darkPaper);
      }
    }
  }

  redrawLayer(layerId: LayerId, elements: DrawingElement[]): void {
    const entry = this.layers.get(layerId);
    if (!entry) return;
    entry.ctx.clearRect(0, 0, this.pageWidth, this.pageHeight);
    const drawings = elements.filter((el) => el.type === "drawing" && el.layer === layerId).sort((a, b) => a.z - b.z);
    for (const el of drawings) {
      renderDrawingElement(entry.ctx, el, this.resolveColor, this.darkPaper);
    }
  }

  drawElement(el: DrawingElement): void {
    const entry = this.layers.get(el.layer);
    if (!entry) return;
    renderDrawingElement(entry.ctx, el, this.resolveColor, this.darkPaper);
  }

  clearLayer(layerId: LayerId): void {
    const entry = this.layers.get(layerId);
    if (!entry) return;
    entry.ctx.clearRect(0, 0, this.pageWidth, this.pageHeight);
  }

  clearLive(): void {
    if (!this.live) return;
    this.live.ctx.clearRect(0, 0, this.pageWidth, this.pageHeight);
  }

  drawLiveStroke(
    points: RawPoint[],
    style: { brush: BrushKind; color: string; size: number; opacity: number; pressureEnabled: boolean },
  ): void {
    if (!this.live) return;
    this.live.ctx.clearRect(0, 0, this.pageWidth, this.pageHeight);
    drawStroke(this.live.ctx, points, {
      ...style,
      color: this.resolveColor(style.color),
      seed: 1,
      darkPaper: this.darkPaper,
    });
  }

  drawEraser(x: number, y: number, radius: number): void {
    if (!this.live) return;
    this.live.ctx.clearRect(0, 0, this.pageWidth, this.pageHeight);
    drawEraserCursor(this.live.ctx, x, y, radius, this.resolveColor("ink"));
  }

  destroy(): void {
    this.layers.clear();
    this.live = null;
  }
}
