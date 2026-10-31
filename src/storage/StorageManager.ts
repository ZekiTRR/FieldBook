import { App, normalizePath } from "obsidian";

export interface ReadResult<T> {
  data: T;
  recovered: boolean;
  source: string;
}

export class StorageManager {
  readonly app: App;
  private folder: string;

  constructor(app: App, folder: string) {
    this.app = app;
    this.folder = StorageManager.normalizeFolder(folder);
  }

  static normalizeFolder(folder: string): string {
    const clean = normalizePath(folder.trim() || "Fieldbook").replace(/^\/+|\/+$/g, "");
    return clean || "Fieldbook";
  }

  get root(): string {
    return this.folder;
  }

  setRoot(folder: string): void {
    this.folder = StorageManager.normalizeFolder(folder);
  }

  path(...parts: string[]): string {
    return normalizePath([this.folder, ...parts].filter(Boolean).join("/"));
  }

  get journalPath(): string {
    return this.path("journal.json");
  }

  pagePath(id: string): string {
    return this.path("pages", `${id}.json`);
  }

  attachmentPath(filename: string): string {
    return this.path("attachments", filename);
  }

  exportPath(filename: string): string {
    return this.path("exports", filename);
  }

  async ensureFolders(): Promise<void> {
    await this.ensureFolder(this.folder);
    await this.ensureFolder(this.path("pages"));
    await this.ensureFolder(this.path("attachments"));
    await this.ensureFolder(this.path("exports"));
  }

  async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized) return;
    const segments = normalized.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) {
        try {
          await this.app.vault.adapter.mkdir(current);
        } catch (error) {
          if (!(await this.app.vault.adapter.exists(current))) throw error;
        }
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async readText(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async readJson<T>(path: string): Promise<ReadResult<T> | null> {
    const candidates = [path, `${path}.bak`];
    for (const candidate of candidates) {
      if (!(await this.exists(candidate))) continue;
      try {
        const text = await this.app.vault.adapter.read(candidate);
        if (!text.trim()) continue;
        return {
          data: JSON.parse(text) as T,
          recovered: candidate !== path,
          source: candidate,
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  async writeJson(path: string, data: unknown, pretty = false): Promise<void> {
    const payload = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await this.safeWrite(path, payload);
  }

  async safeWrite(path: string, payload: string): Promise<void> {
    await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
    if (await this.exists(path)) {
      try {
        const previous = await this.app.vault.adapter.read(path);
        if (previous.length > 0) {
          await this.app.vault.adapter.write(`${path}.bak`, previous);
        }
      } catch {
        /* a failed backup must not block the actual save */
      }
    }
    await this.app.vault.adapter.write(path, payload);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
    await this.app.vault.adapter.writeBinary(path, data);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    return this.app.vault.adapter.readBinary(path);
  }

  async remove(path: string, alsoBackup = true): Promise<void> {
    if (await this.exists(path)) await this.app.vault.adapter.remove(path);
    if (alsoBackup && (await this.exists(`${path}.bak`))) {
      await this.app.vault.adapter.remove(`${path}.bak`);
    }
  }

  async listFiles(folder: string): Promise<string[]> {
    const target = this.path(folder);
    if (!(await this.exists(target))) return [];
    try {
      const listing = await this.app.vault.adapter.list(target);
      return listing.files;
    } catch {
      return [];
    }
  }

  resourcePath(path: string): string {
    return this.app.vault.adapter.getResourcePath(path);
  }

  async uniqueAttachmentName(base: string, extension: string): Promise<string> {
    const safeBase = base.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "image";
    const ext = extension.replace(/^\./, "").toLowerCase() || "png";
    let candidate = `${safeBase}.${ext}`;
    let index = 2;
    while (await this.exists(this.attachmentPath(candidate))) {
      candidate = `${safeBase}-${index}.${ext}`;
      index++;
    }
    return candidate;
  }

  async uniqueExportPath(filename: string): Promise<string> {
    const dot = filename.lastIndexOf(".");
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    let candidate = `${base}${ext}`;
    let index = 2;
    while (await this.exists(this.exportPath(candidate))) {
      candidate = `${base} ${index}${ext}`;
      index++;
    }
    return this.exportPath(candidate);
  }
}
