import type { App } from "obsidian";
import type { PageData, PageMeta, TextElement } from "../types";
import type { JournalManager } from "../core/JournalManager";
import type { StorageManager } from "../storage/StorageManager";
import { renderInkToCanvas, safeExportName, saveCanvasPng } from "./PageSnapshot";

export interface MarkdownExportOptions {
  app: App;
  storage: StorageManager;
  journal: JournalManager;
  page: PageData;
  meta: PageMeta;
}

export async function exportPageToMarkdown(options: MarkdownExportOptions): Promise<string> {
  const { storage, journal, page, meta } = options;
  const tab = journal.getTab(meta.tabId);
  const number = journal.getPageNumber(meta.id);
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: ${yamlString(meta.title)}`);
  lines.push("fieldbook: true");
  lines.push(`fieldbook_page: ${page.id}`);
  lines.push(`fieldbook_tab: ${yamlString(tab?.name ?? "")}`);
  lines.push(`fieldbook_number: ${number}`);
  lines.push(`updated: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push("<!-- Converted from Fieldbook. Freeform positions, tape, layers and exact photo placement exist only in the original page. -->");
  lines.push("");
  lines.push(`# ${meta.title}`);
  lines.push("");

  const ordered = page.elements
    .filter((el) => el.type === "text" || el.type === "image")
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (const el of ordered) {
    if (el.type === "text") {
      const markdown = textElementToMarkdown(el);
      if (markdown) {
        lines.push(markdown);
        lines.push("");
      }
    } else if (el.type === "image") {
      if (!el.attachment) continue;
      lines.push(`![[${el.attachment}]]`);
      lines.push("");
    }
  }

  const hasDrawings = page.elements.some((el) => el.type === "drawing");
  if (hasDrawings) {
    const inkCanvas = await renderInkToCanvas(page, journal, 2);
    const inkPath = await saveCanvasPng(storage, inkCanvas, safeExportName(`${meta.title} - ink`, "png"));
    lines.push("## Ink sketch");
    lines.push("");
    lines.push(`![[${inkPath}]]`);
    lines.push("");
  }

  if (page.elements.some((el) => el.type === "shape" || el.type === "decoration")) {
    lines.push("<!-- Shapes and paper decorations remain in the interactive Fieldbook page. -->");
    lines.push("");
  }

  const filename = safeExportName(meta.title || "Fieldbook page", "md");
  const path = await storage.uniqueExportPath(filename);
  await storage.safeWrite(path, lines.join("\n"));
  return path;
}

function textElementToMarkdown(el: TextElement): string {
  const raw = el.text.trim();
  if (!raw) return "";
  let content = raw;
  if (el.link && !/\[\[/.test(content)) {
    content = `[[${el.link}|${content}]]`;
  }
  const headingLevel =
    el.fontSize >= 46 ? 2 : el.fontSize >= 36 ? 3 : el.fontSize >= 29 ? 4 : 0;
  if (headingLevel) {
    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
    return `${"#".repeat(Math.min(6, headingLevel))} ${lines.join(" ")}`;
  }
  const paragraphs = content.split(/\n{2,}/);
  const rendered = paragraphs.map((paragraph) => {
    const lines = paragraph.split("\n").map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      if (/^[•·-]\s+/.test(trimmed)) {
        return `- ${trimmed.replace(/^[•·-]\s+/, "")}`;
      }
      let text = trimmed;
      if (el.bold) text = `**${text}**`;
      if (el.italic) text = `*${text}*`;
      return text;
    });
    return lines.join("\n");
  });
  return rendered.join("\n\n");
}

function yamlString(value: string): string {
  if (/^[A-Za-z0-9 _\-./]+$/.test(value)) return value;
  return JSON.stringify(value);
}
