import { Notice, TFile, type App } from "obsidian";
import type {
  ImageElement,
  JournalSettings,
  PageElement,
  ShapeElement,
  TextElement,
} from "../types";
import {
  createImageElement,
  createShapeElement,
  createTextElement,
} from "../elements/Factory";
import { loadImageSize } from "../utils/images";
import { parseWikiLink, splitWikiLinks } from "../utils";

export interface ImportedMarkdown {
  pages: PageElement[][];
  imageCount: number;
  skippedImages: number;
}

interface Block {
  kind: "text" | "image" | "rule";
  text?: string;
  fontSize?: number;
  fontFamily?: TextElement["fontFamily"];
  bold?: boolean;
  italic?: boolean;
  color?: string;
  link?: string;
  indent?: number;
  imagePath?: string;
  imageW?: number;
  imageH?: number;
  naturalW?: number;
  naturalH?: number;
  height: number;
  gapAfter: number;
}

const MARGIN_X = 86;
const MARGIN_TOP = 112;
const MARGIN_BOTTOM = 100;

export async function importMarkdown(
  app: App,
  content: string,
  sourcePath: string,
  settings: JournalSettings,
): Promise<ImportedMarkdown> {
  const clean = stripFrontmatter(content);
  const lines = clean.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  let imageCount = 0;
  let skippedImages = 0;
  const contentWidth = settings.pageWidth - MARGIN_X * 2;

  const pushText = (
    text: string,
    options: {
      fontSize?: number;
      fontFamily?: TextElement["fontFamily"];
      bold?: boolean;
      italic?: boolean;
      color?: string;
      link?: string;
      indent?: number;
    } = {},
  ) => {
    const normalized = text.trim();
    if (!normalized) return;
    const fontSize = options.fontSize ?? 27;
    const lineHeight = 1.5;
    const charsPerLine = Math.max(10, Math.floor(contentWidth / (fontSize * 0.53)));
    const paragraphLines = normalized.split("\n");
    let visualLines = 0;
    for (const line of paragraphLines) {
      visualLines += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    const height = Math.max(fontSize * 1.4, visualLines * fontSize * lineHeight + 8);
    blocks.push({
      kind: "text",
      text: normalized,
      fontSize,
      fontFamily: options.fontFamily ?? "body",
      bold: options.bold,
      italic: options.italic,
      color: options.color ?? "ink",
      link: options.link,
      indent: options.indent ?? 0,
      height,
      gapAfter: 14,
    });
  };

  const pushImage = async (link: string, markdownLink: boolean) => {
    const file = resolveImage(app, link, sourcePath, markdownLink);
    if (!file) {
      skippedImages++;
      return;
    }
    const size = await loadImageSize(app.vault.adapter.getResourcePath(file.path));
    if (!size.w || !size.h) {
      skippedImages++;
      return;
    }
    let width = Math.min(560, contentWidth);
    let height = width * (size.h / size.w);
    const maxHeight = settings.pageHeight - MARGIN_TOP - MARGIN_BOTTOM;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * (size.w / size.h);
    }
    blocks.push({
      kind: "image",
      imagePath: file.path,
      imageW: width,
      imageH: height,
      naturalW: size.w,
      naturalH: size.h,
      height,
      gapAfter: 22,
    });
    imageCount++;
  };

  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trimEnd();
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.trim().startsWith("```")) {
      index++;
      const code: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index++;
      }
      index++;
      pushText(code.join("\n"), {
        fontSize: 19,
        fontFamily: "mono",
        color: "ink-soft",
      });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const sizes = [54, 45, 37, 31, 28, 25];
      pushText(inlineToPlain(heading[2]).plain, {
        fontSize: sizes[level - 1],
        fontFamily: "title",
        bold: level <= 3,
        color: "ink",
      });
      index++;
      continue;
    }
    const imageEmbeds = extractImages(line);
    if (imageEmbeds.length) {
      for (const embed of imageEmbeds) await pushImage(embed.link, embed.markdown);
      const leftover = inlineToPlain(stripImages(line)).plain;
      if (leftover.trim()) pushText(leftover);
      index++;
      continue;
    }
    if (/^([-*_])\1{2,}\s*$/.test(line.trim())) {
      blocks.push({ kind: "rule", height: 12, gapAfter: 26 });
      index++;
      continue;
    }
    const list = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (list) {
      const indent = Math.min(3, Math.floor(list[1].length / 2));
      let text = list[3];
      const checkbox = text.match(/^\[( |x|X)\]\s+(.*)$/);
      if (checkbox) text = `${checkbox[1].toLowerCase() === "x" ? "\u2611" : "\u2610"} ${checkbox[2]}`;
      else text = `\u2022 ${text}`;
      pushText(inlineToPlain(text).plain, {
        fontSize: 26,
        indent,
      });
      index++;
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      pushText(inlineToPlain(quote[1]).plain, {
        fontSize: 26,
        italic: true,
        color: "ink-soft",
        indent: 1,
      });
      index++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      pushText(line.trim(), {
        fontSize: 20,
        fontFamily: "mono",
        color: "ink-soft",
      });
      index++;
      continue;
    }
    const wiki = parseWikiLink(line.trim());
    if (wiki) {
      pushText(wiki.alias, { fontSize: 27, link: wiki.target });
      index++;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (!current.trim()) break;
      if (/^(#{1,6})\s+/.test(current)) break;
      if (/^(\s*)([-*+]|\d+\.)\s+/.test(current)) break;
      if (current.trim().startsWith("```")) break;
      if (extractImages(current).length) break;
      paragraph.push(current);
      index++;
    }
    if (paragraph.length) {
      const { plain } = inlineToPlain(paragraph.join("\n"));
      pushText(plain);
    } else {
      index++;
    }
  }

  const pages: PageElement[][] = [];
  let currentPage: PageElement[] = [];
  let y = MARGIN_TOP;
  let zCounter = 1;
  const bottom = settings.pageHeight - MARGIN_BOTTOM;

  const finishPage = () => {
    pages.push(currentPage);
    currentPage = [];
    y = MARGIN_TOP;
    zCounter = 1;
  };

  for (const block of blocks) {
    if (block.kind === "text" && !block.text) continue;
    if (y + block.height > bottom && currentPage.length) finishPage();
    if (block.kind === "text" && block.text) {
      const x = MARGIN_X + (block.indent ?? 0) * 24;
      const el = createTextElement(x, y, {
        text: block.text,
        fontSize: block.fontSize ?? 24,
        fontFamily: block.fontFamily ?? "body",
        bold: block.bold,
        italic: block.italic,
        color: block.color ?? "ink",
        link: block.link ?? "",
        w: contentWidth - (block.indent ?? 0) * 24,
        h: block.height,
        lineHeight: 1.5,
        z: zCounter++,
      });
      currentPage.push(el);
    } else if (block.kind === "image" && block.imagePath) {
      const width = Math.min(block.imageW ?? 480, contentWidth);
      const naturalW = block.naturalW ?? 1000;
      const naturalH = block.naturalH ?? 750;
      const el: ImageElement = createImageElement(
        block.imagePath,
        naturalW,
        naturalH,
        MARGIN_X,
        y,
        {
          w: width,
          h: width * (naturalH / naturalW),
          z: zCounter++,
        },
      );
      currentPage.push(el);
    } else if (block.kind === "rule") {
      const shape: ShapeElement = createShapeElement(
        "line",
        { x: MARGIN_X, y, w: contentWidth, h: 2 },
        [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
        { stroke: "ink-soft", strokeWidth: 1.4, z: zCounter++ },
      );
      currentPage.push(shape);
    }
    y += block.height + block.gapAfter;
  }
  if (currentPage.length || !pages.length) pages.push(currentPage);
  if (skippedImages > 0) {
    new Notice(`Fieldbook import: ${skippedImages} image(s) could not be resolved.`);
  }
  return { pages, imageCount, skippedImages };
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}

function extractImages(line: string): { link: string; markdown: boolean }[] {
  const results: { link: string; markdown: boolean }[] = [];
  const wikiRegex = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wikiRegex.exec(line))) results.push({ link: match[1], markdown: false });
  const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = mdRegex.exec(line))) results.push({ link: match[1], markdown: true });
  return results;
}

function stripImages(line: string): string {
  return line
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "");
}

function resolveImage(app: App, link: string, sourcePath: string, markdown: boolean): TFile | null {
  let target = link.trim();
  if (!target) return null;
  if (/^https?:/i.test(target)) return null;
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  try {
    target = decodeURIComponent(target);
  } catch {
    /* leave as is */
  }
  try {
    const resolved = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    if (resolved && /^(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(resolved.extension)) return resolved;
    if (!markdown) {
      const direct = app.vault.getAbstractFileByPath(target);
      if (direct instanceof TFile && /^(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(direct.extension)) {
        return direct;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function inlineToPlain(raw: string): { plain: string } {
  const { plain: withoutWiki } = splitWikiLinks(raw);
  return {
    plain: withoutWiki
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\u00a0/g, " ")
      .trim(),
  };
}
