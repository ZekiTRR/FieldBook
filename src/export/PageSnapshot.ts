import type { App } from "obsidian";
import type {
  AudioElement,
  DecorationElement,
  DrawingElement,
  ImageElement,
  PageData,
  PageMeta,
  ShapeElement,
  TextElement,
} from "../types";
import type { JournalManager } from "../core/JournalManager";
import type { StorageManager } from "../storage/StorageManager";
import { THEME_MAP, type ThemeDefinition } from "../themes";
import { PALETTE } from "../elements/Renderer";
import { formatVoiceDuration, formatVoiceStamp, voiceBars, voiceParts } from "../elements/VoiceWave";
import { renderDrawingElement } from "../drawing/BrushRenderer";
import { centerOf } from "../utils";

export interface SnapshotOptions {
  app: App;
  page: PageData;
  meta: PageMeta;
  journal: JournalManager;
  scale?: number;
}

interface SnapshotPalette {
  paper: string;
  ink: string;
  inkSoft: string;
  accent: string;
  rule: string;
  highlight: string;
  titleFont: string;
  bodyFont: string;
  monoFont: string;
  serifFont: string;
  dark: boolean;
}

function paletteFor(journal: JournalManager): SnapshotPalette {
  const settings = journal.getSettings();
  const theme: ThemeDefinition = THEME_MAP[settings.theme] ?? THEME_MAP.classic;
  return {
    paper: theme.vars["--fb-paper"],
    ink: theme.vars["--fb-ink"],
    inkSoft: theme.vars["--fb-ink-soft"],
    accent: theme.vars["--fb-accent"],
    rule: "rgba(90, 105, 105, 0.35)",
    highlight: theme.vars["--fb-highlight"],
    titleFont: settings.titleFont.trim() || theme.fonts.title,
    bodyFont: settings.bodyFont.trim() || theme.fonts.body,
    monoFont: theme.fonts.mono,
    serifFont: theme.fonts.serif,
    dark: settings.theme === "dark",
  };
}

function resolveColor(value: string, palette: SnapshotPalette): string {
  switch (value) {
    case "ink":
      return palette.ink;
    case "ink-soft":
      return palette.inkSoft;
    case "accent":
      return palette.accent;
    case "highlight":
      return palette.highlight;
    case "paper":
      return themePaperLight(palette);
    default:
      return PALETTE[value] ?? value;
  }
}

function themePaperLight(palette: SnapshotPalette): string {
  return palette.dark ? "#3a362f" : "#f1e8d3";
}

function fontFor(font: string, palette: SnapshotPalette): string {
  switch (font) {
    case "title":
      return palette.titleFont;
    case "serif":
      return palette.serifFont;
    case "mono":
      return palette.monoFont;
    default:
      return palette.bodyFont;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function noisePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement("canvas");
  tile.width = 96;
  tile.height = 96;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;
  const image = tctx.createImageData(96, 96);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.random() * 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 18;
  }
  tctx.putImageData(image, 0, 0);
  return ctx.createPattern(tile, "repeat");
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const result: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) {
      result.push("");
      continue;
    }
    const words = rawLine.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        result.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

interface LoadedImages {
  map: Map<string, HTMLImageElement | null>;
}

async function loadImages(app: App, page: PageData): Promise<LoadedImages> {
  const paths = new Set<string>();
  for (const el of page.elements) {
    if (el.type === "image" && el.attachment) paths.add(el.attachment);
  }
  const map = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    Array.from(paths).map(
      (path) =>
        new Promise<void>((resolve) => {
          try {
            const img = new Image();
            img.onload = () => {
              map.set(path, img);
              resolve();
            };
            img.onerror = () => {
              map.set(path, null);
              resolve();
            };
            img.src = app.vault.adapter.getResourcePath(path);
          } catch {
            map.set(path, null);
            resolve();
          }
        }),
    ),
  );
  return { map };
}

export async function renderPageToCanvas(options: SnapshotOptions): Promise<HTMLCanvasElement> {
  const { app, page, meta, journal } = options;
  const settings = journal.getSettings();
  const palette = paletteFor(journal);
  const width = settings.pageWidth;
  const height = settings.pageHeight;
  const scale = Math.min(2.5, Math.max(1, options.scale ?? 2));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a drawing context");
  ctx.scale(scale, scale);
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* fonts are optional */
    }
  }
  const images = await loadImages(app, page);

  drawPaper(ctx, width, height, palette, page.background);
  drawVignette(ctx, width, height, palette);

  if (meta.kind === "contents") {
    drawContents(ctx, width, height, journal, palette);
  } else {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = palette.inkSoft;
    ctx.font = `600 24px ${palette.titleFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(meta.title, width / 2, 48);
    ctx.restore();

    const layerOrder = page.layers.slice();
    for (const layer of layerOrder) {
      if (!layer.visible) continue;
      const elements = page.elements
        .filter((el) => el.layer === layer.id)
        .sort((a, b) => a.z - b.z);
      for (const el of elements) {
        ctx.save();
        ctx.globalAlpha = el.opacity;
        if (el.type === "text") drawText(ctx, el, palette);
        else if (el.type === "image") drawImage(ctx, el, palette, images);
        else if (el.type === "shape") drawShape(ctx, el, palette);
        else if (el.type === "decoration") drawDecoration(ctx, el, palette);
        else if (el.type === "audio") drawVoice(ctx, el, palette);
        else if (el.type === "drawing") {
          const clone = { ...el, sampleOpacity: el.sampleOpacity * el.opacity } as DrawingElement;
          renderDrawingElement(ctx, clone, (value) => resolveColor(value, palette), palette.dark);
        }
        ctx.restore();
      }
    }
  }

  if (settings.showPageNumbers) {
    const number = page.number || journal.getPageNumber(page.id);
    if (number > 0) {
      ctx.save();
      ctx.fillStyle = palette.inkSoft;
      ctx.globalAlpha = 0.7;
      ctx.font = `500 17px ${palette.titleFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(String(number), width / 2, height - 32);
      ctx.restore();
    }
  }
  return canvas;
}

function drawPaper(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: SnapshotPalette,
  background: PageData["background"],
): void {
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.dark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.35)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0)");
  gradient.addColorStop(1, palette.dark ? "rgba(0,0,0,0.16)" : "rgba(84, 63, 37, 0.08)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const stain = ctx.createRadialGradient(width * 0.22, height * 0.2, 20, width * 0.22, height * 0.2, width * 0.75);
  stain.addColorStop(0, palette.dark ? "rgba(255, 240, 210, 0.035)" : "rgba(255, 250, 230, 0.18)");
  stain.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = stain;
  ctx.fillRect(0, 0, width, height);
  const pattern = noisePattern(ctx);
  if (pattern) {
    ctx.save();
    ctx.globalAlpha = palette.dark ? 0.35 : 0.55;
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  if (background !== "plain") {
    ctx.save();
    ctx.strokeStyle = palette.dark ? "rgba(226, 211, 180, 0.12)" : "rgba(86, 112, 122, 0.18)";
    ctx.fillStyle = palette.dark ? "rgba(226, 211, 180, 0.2)" : "rgba(86, 112, 122, 0.25)";
    ctx.lineWidth = 0.8;
    const margin = 54;
    if (background === "ruled") {
      for (let y = margin + 28; y < height - margin; y += 34) {
        ctx.beginPath();
        ctx.moveTo(margin, y);
        ctx.lineTo(width - margin, y);
        ctx.stroke();
      }
    } else if (background === "grid") {
      for (let x = margin; x < width - margin; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, margin);
        ctx.lineTo(x, height - margin);
        ctx.stroke();
      }
      for (let y = margin; y < height - margin; y += 32) {
        ctx.beginPath();
        ctx.moveTo(margin, y);
        ctx.lineTo(width - margin, y);
        ctx.stroke();
      }
    } else {
      for (let x = margin; x < width - margin; x += 30) {
        for (let y = margin; y < height - margin; y += 30) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number, palette: SnapshotPalette): void {
  const edge = ctx.createLinearGradient(0, 0, width, 0);
  edge.addColorStop(0, palette.dark ? "rgba(0,0,0,0.28)" : "rgba(73, 51, 28, 0.16)");
  edge.addColorStop(0.04, "rgba(0,0,0,0)");
  edge.addColorStop(0.96, "rgba(0,0,0,0)");
  edge.addColorStop(1, palette.dark ? "rgba(0,0,0,0.28)" : "rgba(73, 51, 28, 0.16)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, width, height);
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement, palette: SnapshotPalette): void {
  if (!el.text.trim()) return;
  const center = centerOf(el);
  ctx.translate(center.x, center.y);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.w / 2, -el.h / 2);
  ctx.font = `${el.italic ? "italic " : ""}${el.bold ? "700" : "400"} ${el.fontSize}px ${fontFor(el.fontFamily, palette)}`;
  ctx.fillStyle = resolveColor(el.color, palette);
  ctx.textBaseline = "top";
  const lines = wrapLines(ctx, el.text, el.w);
  const lineHeight = el.fontSize * el.lineHeight;
  lines.forEach((line, index) => {
    let x = 0;
    if (el.align === "center") x = (el.w - ctx.measureText(line).width) / 2;
    else if (el.align === "right") x = el.w - ctx.measureText(line).width;
    ctx.fillText(line, x, index * lineHeight + 2);
  });
  if (el.underline && lines.length) {
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = Math.max(1, el.fontSize * 0.05);
    lines.forEach((line, index) => {
      const lineWidth = ctx.measureText(line).width;
      let x = 0;
      if (el.align === "center") x = (el.w - lineWidth) / 2;
      else if (el.align === "right") x = el.w - lineWidth;
      const y = (index + 1) * lineHeight - 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lineWidth, y);
      ctx.stroke();
    });
  }
}

function drawImage(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
  palette: SnapshotPalette,
  images: LoadedImages,
): void {
  const center = centerOf(el);
  ctx.translate(center.x, center.y);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.w / 2, -el.h / 2);
  if (el.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = palette.dark ? "#26231f" : "#f7f0df";
    roundRect(ctx, 0, 0, el.w, el.h, el.radius);
    ctx.fill();
    ctx.restore();
  }
  const img = images.map.get(el.attachment);
  ctx.save();
  roundRect(ctx, 0, 0, el.w, el.h, el.radius);
  ctx.clip();
  if (img) {
    const naturalW = img.naturalWidth || el.naturalW || 1;
    const naturalH = img.naturalHeight || el.naturalH || 1;
    const sx = naturalW * el.crop.x;
    const sy = naturalH * el.crop.y;
    const sw = naturalW * el.crop.w;
    const sh = naturalH * el.crop.h;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, el.w, el.h);
  } else {
    ctx.fillStyle = palette.dark ? "#3d3831" : "#e4dcc8";
    ctx.fillRect(0, 0, el.w, el.h);
    ctx.strokeStyle = palette.inkSoft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(el.w, el.h);
    ctx.moveTo(el.w, 0);
    ctx.lineTo(0, el.h);
    ctx.stroke();
  }
  ctx.restore();
  if (el.border) {
    ctx.strokeStyle = palette.dark ? "rgba(240,228,205,0.18)" : "rgba(60, 47, 32, 0.22)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, 0, 0, el.w, el.h, el.radius);
    ctx.stroke();
  }
}

function drawShape(ctx: CanvasRenderingContext2D, el: ShapeElement, palette: SnapshotPalette): void {
  const center = centerOf(el);
  ctx.translate(center.x, center.y);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.w / 2, -el.h / 2);
  ctx.lineWidth = el.strokeWidth;
  ctx.strokeStyle = resolveColor(el.stroke, palette);
  ctx.fillStyle = el.fill === "none" ? "transparent" : resolveColor(el.fill, palette);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (el.dashed) ctx.setLineDash([el.strokeWidth * 3.2, el.strokeWidth * 2.4]);
  ctx.beginPath();
  if (el.shape === "rect") {
    roundRect(ctx, el.strokeWidth / 2, el.strokeWidth / 2, el.w - el.strokeWidth, el.h - el.strokeWidth, 1);
  } else if (el.shape === "ellipse") {
    ctx.ellipse(el.w / 2, el.h / 2, Math.max(1, el.w / 2 - el.strokeWidth / 2), Math.max(1, el.h / 2 - el.strokeWidth / 2), 0, 0, Math.PI * 2);
  } else if (el.shape === "polygon") {
    const sides = Math.max(3, Math.min(12, Math.round(el.sides)));
    for (let i = 0; i < sides; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
      const x = el.w / 2 + Math.cos(angle) * (el.w / 2 - el.strokeWidth / 2);
      const y = el.h / 2 + Math.sin(angle) * (el.h / 2 - el.strokeWidth / 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    const a = el.points[0] ?? { x: 0, y: 0 };
    const b = el.points[1] ?? { x: 1, y: 1 };
    const x1 = a.x * el.w;
    const y1 = a.y * el.h;
    const x2 = b.x * el.w;
    const y2 = b.y * el.h;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (el.shape === "arrow") {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = Math.max(8, el.strokeWidth * 3.4);
      ctx.save();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(angle - 0.5), y2 - size * Math.sin(angle - 0.5));
      ctx.lineTo(x2 - size * Math.cos(angle + 0.5), y2 - size * Math.sin(angle + 0.5));
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      ctx.restore();
    }
  }
  if (el.fill !== "none") ctx.fill();
  ctx.stroke();
}

function drawDecoration(ctx: CanvasRenderingContext2D, el: DecorationElement, palette: SnapshotPalette): void {
  const center = centerOf(el);
  ctx.translate(center.x, center.y);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.w / 2, -el.h / 2);
  const color = resolveColor(el.color, palette);
  ctx.save();
  switch (el.decor) {
    case "tape": {
      ctx.globalAlpha *= 0.62;
      ctx.fillStyle = color;
      ctx.beginPath();
      const jag = 3;
      ctx.moveTo(0, 0);
      for (let i = 0; i <= 10; i++) {
        ctx.lineTo((el.w / 10) * i, (i % 2 === 0 ? 0 : jag));
      }
      ctx.lineTo(el.w, el.h);
      for (let i = 10; i >= 0; i--) {
        ctx.lineTo((el.w / 10) * i, el.h - (i % 2 === 0 ? 0 : jag));
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha *= 0.6;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, el.h * 0.25);
      ctx.lineTo(el.w, el.h * 0.25);
      ctx.stroke();
      break;
    }
    case "glue": {
      const gradient = ctx.createRadialGradient(el.w / 2, el.h / 2, 2, el.w / 2, el.h / 2, el.w / 2);
      gradient.addColorStop(0, hexWithAlpha(color, 0.24));
      gradient.addColorStop(1, hexWithAlpha(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(el.w / 2, el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "sticker": {
      ctx.fillStyle = palette.dark ? "#39352e" : "#f4ecd9";
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(el.w / 2, el.h / 2, Math.min(el.w, el.h) / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha *= 0.75;
      drawStar(ctx, el.w / 2, el.h / 2, Math.min(el.w, el.h) * 0.28, 5);
      break;
    }
    case "bookmark": {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(el.w, 0);
      ctx.lineTo(el.w, el.h);
      ctx.lineTo(el.w / 2, el.h - el.h * 0.12);
      ctx.lineTo(0, el.h);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha *= 0.35;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(el.w * 0.2, 0);
      ctx.lineTo(el.w * 0.2, el.h * 0.9);
      ctx.stroke();
      break;
    }
    case "frame": {
      ctx.strokeStyle = color;
      ctx.globalAlpha *= 0.7;
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, el.w - 8, el.h - 8);
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 12, el.w - 24, el.h - 24);
      break;
    }
    case "marker": {
      ctx.globalAlpha *= 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(0, el.h * 0.15, el.w, el.h * 0.7);
      break;
    }
    case "photoCorner": {
      ctx.fillStyle = hexWithAlpha(color, 0.85);
      const size = Math.min(el.w, el.h) * 0.34;
      const triangles = [
        [0, 0, size, 0, 0, size],
        [el.w, 0, el.w - size, 0, el.w, size],
        [0, el.h, size, el.h, 0, el.h - size],
        [el.w, el.h, el.w - size, el.h, el.w, el.h - size],
      ];
      for (const tri of triangles) {
        ctx.beginPath();
        ctx.moveTo(tri[0], tri[1]);
        ctx.lineTo(tri[2], tri[3]);
        ctx.lineTo(tri[4], tri[5]);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function drawVoice(ctx: CanvasRenderingContext2D, el: AudioElement, palette: SnapshotPalette): void {
  const center = centerOf(el);
  ctx.translate(center.x, center.y);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.w / 2, -el.h / 2);

  const parts = voiceParts(el.w, el.h);
  const ink = resolveColor(el.color, palette);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.26)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = palette.dark ? "rgba(52,48,42,0.95)" : "rgba(241,232,209,0.9)";
  roundRect(ctx, 0, 0, el.w, el.h, 3);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = palette.dark ? "#1b1916" : "#c9b78f";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, el.w - 1, el.h - 1, 3);
  ctx.stroke();

  if (el.mount === "tape") {
    ctx.save();
    ctx.translate(-12 + 46, -13 + 13.5);
    ctx.rotate((-7 * Math.PI) / 180);
    ctx.fillStyle = palette.dark ? "rgba(216,174,111,0.28)" : "rgba(221,210,182,0.6)";
    ctx.fillRect(-46, -13.5, 92, 27);
    ctx.restore();
  } else if (el.mount === "corners") {
    const size = 26;
    ctx.fillStyle = palette.dark ? "rgba(216,174,111,0.24)" : "rgba(210,196,160,0.75)";
    const fold = (points: [number, number][]) => {
      ctx.beginPath();
      points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    };
    fold([[0, 0], [size, 0], [0, size]]);
    fold([[el.w, 0], [el.w - size, 0], [el.w, size]]);
    fold([[0, el.h], [size, el.h], [0, el.h - size]]);
    fold([[el.w, el.h], [el.w - size, el.h], [el.w, el.h - size]]);
  }

  const bars = voiceBars(el.peaks, el.seed, el.w);
  ctx.lineCap = "round";
  ctx.strokeStyle = ink;
  for (const bar of bars) {
    const top = parts.wave.y + bar.top;
    const bottom = parts.wave.y + bar.bottom;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(bar.x + bar.tilt, top);
    ctx.lineTo(bar.x, bottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(bar.x, top);
    ctx.lineTo(bar.x - bar.tilt, bottom);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const cx = parts.play.x + parts.play.w / 2;
  const cy = parts.play.y + parts.play.h / 2;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.arc(cx, cy, 17.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 19.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - 4.2, cy - 6.8);
  ctx.lineTo(cx + 6.4, cy);
  ctx.lineTo(cx - 4.2, cy + 6.8);
  ctx.closePath();
  ctx.stroke();

  const caption = el.label.trim() || formatVoiceStamp(el.recordedAt);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ink;
  ctx.font = `500 22px ${palette.titleFont}`;
  ctx.fillText(formatVoiceDuration(el.duration), el.w - 13, cy - 1);
  if (caption) {
    ctx.fillStyle = palette.inkSoft;
    ctx.font = `400 11.5px ${palette.bodyFont}`;
    ctx.fillText(caption, el.w - 13, cy + 15);
  }
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, points: number): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function hexWithAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function drawContents(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  journal: JournalManager,
  palette: SnapshotPalette,
): void {
  const margin = 92;
  ctx.save();
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.accent;
  ctx.globalAlpha = 0.7;
  ctx.font = `600 15px ${palette.bodyFont}`;
  ctx.textAlign = "center";
  ctx.fillText("FIELD NOTES", width / 2, 70);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.ink;
  ctx.font = `700 54px ${palette.titleFont}`;
  ctx.fillText(journal.journal.title, width / 2, 100);
  ctx.font = `500 24px ${palette.bodyFont}`;
  ctx.fillStyle = palette.inkSoft;
  ctx.fillText("Contents", width / 2, 168);
  ctx.strokeStyle = palette.inkSoft;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(width * 0.3, 210);
  ctx.lineTo(width * 0.7, 210);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const entries = journal.getToc();
  let y = 250;
  let currentTab = "";
  ctx.textAlign = "left";
  for (const entry of entries.slice(0, 24)) {
    if (entry.tabName !== currentTab) {
      currentTab = entry.tabName;
      if (y > 250) y += 16;
      ctx.fillStyle = palette.accent;
      ctx.font = `600 19px ${palette.bodyFont}`;
      ctx.fillText(currentTab.toUpperCase(), margin, y);
      y += 30;
    }
    const numberWidth = 36;
    const labelWidth = width - margin * 2 - numberWidth;
    ctx.fillStyle = palette.ink;
    ctx.font = `400 23px ${palette.bodyFont}`;
    const title = fitText(ctx, entry.title, labelWidth - 20);
    ctx.fillText(title, margin, y);
    const titleWidth = ctx.measureText(title).width;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = palette.inkSoft;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(margin + titleWidth + 8, y + 15);
    ctx.lineTo(width - margin - numberWidth, y + 15);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.inkSoft;
    ctx.font = `500 20px ${palette.titleFont}`;
    ctx.textAlign = "right";
    ctx.fillText(String(entry.number), width - margin, y);
    ctx.textAlign = "left";
    y += 40;
    if (y > height - 80) break;
  }
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 3 && ctx.measureText(`${value}\u2026`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}\u2026`;
}

export async function renderInkToCanvas(
  page: PageData,
  journal: JournalManager,
  scale = 2,
): Promise<HTMLCanvasElement> {
  const settings = journal.getSettings();
  const palette = paletteFor(journal);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(settings.pageWidth * scale);
  canvas.height = Math.round(settings.pageHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a drawing context");
  ctx.scale(scale, scale);
  const hidden = new Set(page.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const drawings = page.elements
    .filter((el): el is DrawingElement => el.type === "drawing" && !hidden.has(el.layer))
    .sort((a, b) => a.z - b.z);
  for (const el of drawings) {
    ctx.save();
    ctx.globalAlpha = el.opacity;
    renderDrawingElement(ctx, el, (value) => resolveColor(value, palette), palette.dark);
    ctx.restore();
  }
  return canvas;
}

export async function saveCanvasPng(
  storage: StorageManager,
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<string> {
  const path = await storage.uniqueExportPath(filename);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/png"));
  if (!blob) throw new Error("PNG encoding failed");
  const buffer = await blob.arrayBuffer();
  await storage.writeBinary(path, buffer);
  return path;
}

export function safeExportName(title: string, extension: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "fieldbook-page";
  return `${clean}.${extension}`;
}

