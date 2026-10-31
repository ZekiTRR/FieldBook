import type { App } from "obsidian";
import { Notice } from "obsidian";
import type { StorageManager } from "../storage/StorageManager";
import { sanitizeFilename } from "../utils";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

export interface SavedImage {
  path: string;
  naturalW: number;
  naturalH: number;
}

export function extensionFromFile(file: File): string {
  const fromName = file.name?.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && fromName.length <= 5) return fromName === "jpeg" ? "jpg" : fromName;
  return MIME_EXTENSIONS[file.type] ?? "png";
}

export function loadImageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

export async function saveImageFile(
  _app: App,
  storage: StorageManager,
  file: File,
  baseName: string,
): Promise<SavedImage | null> {
  if (!file.type.startsWith("image/") && !file.name.match(/\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i)) {
    return null;
  }
  try {
    const ext = extensionFromFile(file);
    const cleanBase = sanitizeFilename(baseName || file.name.replace(/\.[^.]+$/, ""), "image");
    const filename = await storage.uniqueAttachmentName(cleanBase, ext);
    const buffer = await file.arrayBuffer();
    const path = storage.attachmentPath(filename);
    await storage.writeBinary(path, buffer);
    const url = storage.resourcePath(path);
    const size = await loadImageSize(url);
    if (!size.w || !size.h) {
      new Notice(`Fieldbook: saved ${filename}, but the image could not be previewed.`);
    }
    return { path, naturalW: size.w || 900, naturalH: size.h || 1200 };
  } catch (error) {
    console.error("Fieldbook: image import failed", error);
    new Notice("Fieldbook: could not add the image.");
    return null;
  }
}

export async function getVaultImageSize(app: App, path: string): Promise<{ w: number; h: number }> {
  try {
    const url = app.vault.adapter.getResourcePath(path);
    return await loadImageSize(url);
  } catch {
    return { w: 0, h: 0 };
  }
}
