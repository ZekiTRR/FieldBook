import { setIcon } from "obsidian";
import type {
  DecorationElement,
  ImageElement,
  PageElement,
  ShapeElement,
  TextElement,
} from "../types";

export const PALETTE: Record<string, string> = {
  cream: "#ddd2b6",
  ocean: "#7d97a7",
  sage: "#9aa47f",
  rust: "#ad6c52",
  plum: "#8a6780",
  gold: "#bca061",
  charcoal: "#5f574c",
  rose: "#b88a84",
  paper: "#f1e8d3",
  graphite: "#3a3a38",
  crimson: "#92382f",
  forest: "#536444",
  navy: "#3c5164",
  amber: "#c1933f",
  white: "#f6f3ea",
  black: "#1f1d1a",
};

const TOKENS: Record<string, string> = {
  ink: "var(--fb-ink)",
  "ink-soft": "var(--fb-ink-soft)",
  accent: "var(--fb-accent)",
  highlight: "var(--fb-highlight)",
  muted: "var(--fb-rule)",
};

export function colorValue(color: string): string {
  if (!color) return "var(--fb-ink)";
  if (TOKENS[color]) return TOKENS[color];
  if (PALETTE[color]) return PALETTE[color];
  return color;
}

export function rawColorValue(color: string, fallback = "#2b251c"): string {
  if (TOKENS[color]) {
    if (color === "ink") return fallback;
    if (color === "accent") return "#8a3b2e";
    if (color === "highlight") return "#e7c45a";
    return fallback;
  }
  return PALETTE[color] ?? (color.startsWith("#") ? color : fallback);
}

export function createElementNode(
  el: PageElement,
  resourcePath: (path: string) => string,
  attachmentExists: (path: string) => boolean,
): HTMLElement {
  const node = document.createElement("div");
  node.className = `fb-el fb-el--${el.type}`;
  node.dataset.elementId = el.id;
  node.style.opacity = String(el.opacity);
  node.style.zIndex = String(el.z);
  if (el.locked) node.classList.add("is-locked");
  if (el.pinned) node.classList.add("is-pinned");
  applyElementFrame(node, el);

  if (el.type === "text") {
    node.appendChild(renderText(el));
  } else if (el.type === "image") {
    node.appendChild(renderImage(el, resourcePath, attachmentExists));
  } else if (el.type === "shape") {
    node.appendChild(renderShape(el));
  } else if (el.type === "decoration") {
    node.appendChild(renderDecoration(el));
  }
  return node;
}

export function applyElementFrame(node: HTMLElement, el: PageElement): void {
  node.style.width = `${Math.max(1, el.w)}px`;
  node.style.height = `${Math.max(1, el.h)}px`;
  node.style.transform = `translate3d(${el.x}px, ${el.y}px, 0) rotate(${el.rotation}deg)`;
  node.style.opacity = String(el.opacity);
  node.style.zIndex = String(Math.round(el.z));
}

export function renderText(el: TextElement): HTMLElement {
  const body = document.createElement("div");
  body.className = "fb-text";
  if (!el.text.trim()) body.classList.add("is-empty");
  body.dataset.placeholder = "Double-click to write";
  body.style.fontFamily = `var(--fb-font-${el.fontFamily})`;
  body.style.fontSize = `${el.fontSize}px`;
  body.style.color = colorValue(el.color);
  body.style.fontWeight = el.bold ? "700" : "400";
  body.style.fontStyle = el.italic ? "italic" : "normal";
  body.style.textDecoration = el.underline ? "underline" : "none";
  body.style.textAlign = el.align;
  body.style.lineHeight = String(el.lineHeight);
  body.textContent = el.text;
  if (el.link) {
    body.classList.add("has-link");
    body.dataset.link = el.link;
  }
  return body;
}

export function renderImage(
  el: ImageElement,
  resourcePath: (path: string) => string,
  attachmentExists: (path: string) => boolean,
): HTMLElement {
  const frame = document.createElement("div");
  frame.className = "fb-image";
  if (el.border) frame.classList.add("has-border");
  if (el.shadow) frame.classList.add("has-shadow");
  frame.style.borderRadius = `${el.radius}px`;
  if (!el.attachment || !attachmentExists(el.attachment)) {
    frame.classList.add("is-missing");
    const missing = document.createElement("div");
    missing.className = "fb-image__missing";
    const icon = document.createElement("span");
    icon.className = "fb-image__missing-icon";
    setIcon(icon, "image-off");
    const label = document.createElement("span");
    label.className = "fb-image__missing-label";
    label.textContent = el.attachment ? el.attachment.split("/").pop() ?? "Missing image" : "No image";
    missing.append(icon, label);
    frame.appendChild(missing);
    return frame;
  }
  const img = document.createElement("img");
  img.className = "fb-image__img";
  img.draggable = false;
  img.decoding = "async";
  img.src = resourcePath(el.attachment);
  img.alt = el.attachment.split("/").pop() ?? "";
  const crop = el.crop;
  img.style.width = `${100 / Math.max(0.02, crop.w)}%`;
  img.style.height = `${100 / Math.max(0.02, crop.h)}%`;
  img.style.left = `${-(crop.x / Math.max(0.02, crop.w)) * 100}%`;
  img.style.top = `${-(crop.y / Math.max(0.02, crop.h)) * 100}%`;
  frame.appendChild(img);
  const sheen = document.createElement("div");
  sheen.className = "fb-image__sheen";
  frame.appendChild(sheen);
  return frame;
}

export function renderShape(el: ShapeElement): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const width = Math.max(1, el.w);
  const height = Math.max(1, el.h);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.classList.add("fb-shape");
  svg.style.overflow = "visible";
  const stroke = colorValue(el.stroke);
  const fill = el.fill === "none" ? "none" : colorValue(el.fill);
  const sw = el.strokeWidth;
  const common = {
    stroke,
    "stroke-width": String(sw),
    fill,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    ...(el.dashed ? { "stroke-dasharray": `${sw * 3.2} ${sw * 2.4}` } : {}),
  };

  if (el.shape === "rect") {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(sw / 2));
    rect.setAttribute("y", String(sw / 2));
    rect.setAttribute("width", String(Math.max(0, width - sw)));
    rect.setAttribute("height", String(Math.max(0, height - sw)));
    rect.setAttribute("rx", "1");
    for (const [key, value] of Object.entries(common)) rect.setAttribute(key, value);
    svg.appendChild(rect);
  } else if (el.shape === "ellipse") {
    const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
    ellipse.setAttribute("cx", String(width / 2));
    ellipse.setAttribute("cy", String(height / 2));
    ellipse.setAttribute("rx", String(Math.max(0.5, width / 2 - sw / 2)));
    ellipse.setAttribute("ry", String(Math.max(0.5, height / 2 - sw / 2)));
    for (const [key, value] of Object.entries(common)) ellipse.setAttribute(key, value);
    svg.appendChild(ellipse);
  } else if (el.shape === "polygon") {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", polygonPoints(width, height, el.sides, sw));
    for (const [key, value] of Object.entries(common)) polygon.setAttribute(key, value);
    svg.appendChild(polygon);
  } else {
    const a = el.points[0] ?? { x: 0, y: 0 };
    const b = el.points[1] ?? { x: 1, y: 1 };
    const x1 = a.x * width;
    const y1 = a.y * height;
    const x2 = b.x * width;
    const y2 = b.y * height;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    for (const [key, value] of Object.entries(common)) line.setAttribute(key, value);
    line.setAttribute("fill", "none");
    svg.appendChild(line);
    if (el.shape === "arrow") {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = Math.max(8, sw * 3.4);
      const spread = 0.5;
      const p1 = {
        x: x2 - size * Math.cos(angle - spread),
        y: y2 - size * Math.sin(angle - spread),
      };
      const p2 = {
        x: x2 - size * Math.cos(angle + spread),
        y: y2 - size * Math.sin(angle + spread),
      };
      const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      head.setAttribute("points", `${x2},${y2} ${p1.x},${p1.y} ${p2.x},${p2.y}`);
      head.setAttribute("fill", stroke);
      head.setAttribute("stroke", stroke);
      head.setAttribute("stroke-width", String(Math.max(1, sw * 0.6)));
      head.setAttribute("stroke-linejoin", "round");
      svg.appendChild(head);
    }
  }
  return svg;
}

function polygonPoints(w: number, h: number, sides: number, sw: number): string {
  const count = Math.max(3, Math.min(12, Math.round(sides)));
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(1, w / 2 - sw / 2);
  const ry = Math.max(1, h / 2 - sw / 2);
  const points: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
    points.push(`${cx + Math.cos(angle) * rx},${cy + Math.sin(angle) * ry}`);
  }
  return points.join(" ");
}

export function renderDecoration(el: DecorationElement): HTMLElement {
  const host = document.createElement("div");
  host.className = `fb-deco fb-deco--${el.decor} fb-deco-v${el.variant % 3}`;
  host.style.setProperty("--deco-color", colorValue(el.color));
  if (el.attachTo) host.classList.add("is-attached");

  switch (el.decor) {
    case "tape": {
      const body = document.createElement("div");
      body.className = "fb-tape";
      const grain = document.createElement("div");
      grain.className = "fb-tape__grain";
      const shine = document.createElement("div");
      shine.className = "fb-tape__shine";
      host.append(body, grain, shine);
      break;
    }
    case "glue": {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 120 100");
      svg.classList.add("fb-glue");
      const paths = [
        "M14 40C8 21 30 8 51 11 73 4 98 18 101 36 108 53 87 71 67 74 55 92 29 89 21 76 6 71 2 55 14 40Z",
        "M9 48C4 28 24 9 47 12 67 2 95 14 102 34 111 55 94 72 74 77 58 92 28 94 18 78 4 69 1 59 9 48Z",
        "M17 33C20 14 43 6 60 14 81 7 104 24 100 43 105 62 84 73 64 72 50 88 24 85 18 69 5 60 10 45 17 33Z",
      ];
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", paths[el.variant % paths.length]);
      path.setAttribute("fill", "var(--deco-color)");
      path.setAttribute("opacity", "0.24");
      path.setAttribute("filter", "blur(1px)");
      svg.appendChild(path);
      const shine = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shine.setAttribute("d", paths[(el.variant + 1) % paths.length]);
      shine.setAttribute("fill", "none");
      shine.setAttribute("stroke", "rgba(255,255,255,0.35)");
      shine.setAttribute("stroke-width", "2");
      svg.appendChild(shine);
      host.appendChild(svg);
      break;
    }
    case "sticker": {
      host.appendChild(renderStickerSvg(el.variant));
      break;
    }
    case "bookmark": {
      const ribbon = document.createElement("div");
      ribbon.className = "fb-bookmark";
      const line = document.createElement("div");
      line.className = "fb-bookmark__line";
      ribbon.appendChild(line);
      host.appendChild(ribbon);
      break;
    }
    case "frame": {
      for (const side of ["top", "right", "bottom", "left"]) {
        const edge = document.createElement("div");
        edge.className = `fb-frame__edge fb-frame__edge--${side}`;
        host.appendChild(edge);
      }
      for (const corner of ["tl", "tr", "bl", "br"]) {
        const mark = document.createElement("div");
        mark.className = `fb-frame__corner fb-frame__corner--${corner}`;
        host.appendChild(mark);
      }
      break;
    }
    case "marker": {
      const strip = document.createElement("div");
      strip.className = "fb-marker-strip";
      host.appendChild(strip);
      break;
    }
    case "photoCorner": {
      for (const corner of ["tl", "tr", "bl", "br"]) {
        const fold = document.createElement("div");
        fold.className = `fb-photo-corner fb-photo-corner--${corner}`;
        host.appendChild(fold);
      }
      break;
    }
  }
  return host;
}

function renderStickerSvg(variant: number): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.classList.add("fb-sticker");
  if (variant % 3 === 0) {
    const burst = document.createElementNS("http://www.w3.org/2000/svg", "path");
    burst.setAttribute("d", starburstPath(60, 60, 56, 46, 16));
    burst.setAttribute("fill", "var(--fb-paper-3)");
    burst.setAttribute("stroke", "var(--deco-color)");
    burst.setAttribute("stroke-width", "1.4");
    svg.appendChild(burst);
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    ring.setAttribute("cx", "60");
    ring.setAttribute("cy", "60");
    ring.setAttribute("r", "34");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "var(--deco-color)");
    ring.setAttribute("stroke-width", "1");
    ring.setAttribute("stroke-dasharray", "2 4");
    svg.appendChild(ring);
    const star = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    star.setAttribute("points", starPoints(60, 62, 24, 10, 5));
    star.setAttribute("fill", "var(--deco-color)");
    star.setAttribute("opacity", "0.8");
    svg.appendChild(star);
  } else if (variant % 3 === 1) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "60");
    circle.setAttribute("cy", "60");
    circle.setAttribute("r", "50");
    circle.setAttribute("fill", "var(--deco-color)");
    circle.setAttribute("opacity", "0.82");
    svg.appendChild(circle);
    const inner = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    inner.setAttribute("cx", "60");
    inner.setAttribute("cy", "60");
    inner.setAttribute("r", "41");
    inner.setAttribute("fill", "none");
    inner.setAttribute("stroke", "var(--fb-paper-3)");
    inner.setAttribute("stroke-width", "1.2");
    inner.setAttribute("stroke-dasharray", "1 5");
    svg.appendChild(inner);
    const star = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    star.setAttribute("points", starPoints(60, 60, 28, 12, 4));
    star.setAttribute("fill", "var(--fb-paper-3)");
    star.setAttribute("opacity", "0.9");
    svg.appendChild(star);
  } else {
    const note = document.createElementNS("http://www.w3.org/2000/svg", "path");
    note.setAttribute(
      "d",
      "M14 22C34 16 82 15 104 20c4 24 4 60-2 80-26-5-62-4-88 1-4-24-4-58 0-79Z",
    );
    note.setAttribute("fill", "var(--fb-paper-3)");
    note.setAttribute("stroke", "var(--deco-color)");
    note.setAttribute("stroke-width", "1.5");
    svg.appendChild(note);
    for (let i = 0; i < 3; i++) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "30");
      line.setAttribute("y1", String(48 + i * 14));
      line.setAttribute("x2", String(i === 2 ? 74 : 90));
      line.setAttribute("y2", String(48 + i * 14));
      line.setAttribute("stroke", "var(--deco-color)");
      line.setAttribute("stroke-width", "1.2");
      line.setAttribute("opacity", "0.5");
      svg.appendChild(line);
    }
  }
  return svg;
}

function starburstPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    coords.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return `M${coords.join("L")}Z`;
}

function starPoints(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    coords.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return coords.join(" ");
}

