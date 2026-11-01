import { App, Notice } from "obsidian";
import {
  DATA_VERSION,
  DEFAULT_LAYERS,
  DEFAULT_JOURNAL_SETTINGS,
  type JournalData,
  type JournalSettings,
  type PageBackground,
  type PageData,
  type PageKind,
  type PageMeta,
  type Spread,
  type SpreadSlot,
  type TabColor,
  type TabData,
  type TocEntry,
  type TrashedPage,
} from "../types";
import { StorageManager } from "../storage/StorageManager";
import { normalizeJournal, normalizePage } from "../storage/Migrations";
import { nowIso, uid } from "../utils";

export interface StoreEvent {
  type: "structure" | "journal" | "page" | "settings";
  pageId?: string;
}

type Listener = (event: StoreEvent) => void;

export class JournalManager {
  readonly app: App;
  readonly storage: StorageManager;
  journal!: JournalData;

  private readonly pageCache = new Map<string, PageData>();
  private readonly dirtyPages = new Set<string>();
  private journalDirty = false;
  private layoutCache: Spread[] | null = null;
  private timer: number | null = null;
  private listeners = new Set<Listener>();
  private saveChain: Promise<void> = Promise.resolve();
  private readonly defaultTitle: string;

  constructor(app: App, storage: StorageManager, defaultTitle = "Fieldbook") {
    this.app = app;
    this.storage = storage;
    this.defaultTitle = defaultTitle;
  }

  async init(): Promise<void> {
    await this.storage.ensureFolders();
    const result = await this.storage.readJson<unknown>(this.storage.journalPath);
    if (result) {
      this.journal = normalizeJournal(result.data, this.defaultTitle);
      if (result.recovered) {
        new Notice("Fieldbook: journal was recovered from its backup copy.");
      }
    } else {
      this.journal = this.buildInitialJournal();
      await this.persistInitial();
    }
    if (!this.journal.tabs.length) {
      const tab = this.buildTab("Journal", "cream", "bookmark");
      this.journal.tabs.push(tab);
      const page = await this.buildPage(tab.id, "Page 1", "freeform");
      tab.pageIds.push(page.id);
      this.journal.pages[page.id] = this.metaFromPage(page);
      this.pageCache.set(page.id, page);
      this.markPageDirty(page.id, false);
      this.markJournalDirty(false);
    }
    this.layoutCache = null;
  }

  private buildInitialJournal(): JournalData {
    const now = nowIso();
    return {
      version: DATA_VERSION,
      id: uid("journal"),
      title: this.defaultTitle,
      createdAt: now,
      updatedAt: now,
      settings: {
        ...DEFAULT_JOURNAL_SETTINGS,
        brushes: JSON.parse(JSON.stringify(DEFAULT_JOURNAL_SETTINGS.brushes)) as JournalSettings["brushes"],
      },
      tabs: [],
      pages: {},
      trash: [],
    };
  }

  private async persistInitial(): Promise<void> {
    const tab = this.buildTab("Journal", "cream", "bookmark");
    this.journal.tabs.push(tab);
    const page = await this.buildPage(tab.id, "Page 1", "freeform");
    tab.pageIds.push(page.id);
    this.journal.pages[page.id] = this.metaFromPage(page);
    this.pageCache.set(page.id, page);
    await this.storage.writeJson(this.storage.pagePath(page.id), page);
    this.journal.updatedAt = nowIso();
    await this.storage.writeJson(this.storage.journalPath, this.journal, true);
  }

  private buildTab(name: string, color: TabColor, icon: string): TabData {
    return { id: uid("tab"), name, color, icon, pageIds: [] };
  }

  private metaFromPage(page: PageData): PageMeta {
    return {
      id: page.id,
      title: page.title,
      tabId: page.tabId,
      kind: page.kind,
      background: page.background,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    };
  }

  private async buildPage(
    tabId: string,
    title: string,
    kind: PageKind,
    background?: PageBackground,
  ): Promise<PageData> {
    const now = nowIso();
    return {
      version: DATA_VERSION,
      id: uid("page"),
      title,
      number: 0,
      tabId,
      kind,
      background: background ?? this.journal.settings.defaultBackground,
      layers: DEFAULT_LAYERS.map((layer) => ({ ...layer })),
      elements: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: StoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  getSettings(): JournalSettings {
    return this.journal.settings;
  }

  getTabs(): TabData[] {
    return this.journal.tabs;
  }

  getTab(id: string): TabData | undefined {
    return this.journal.tabs.find((tab) => tab.id === id);
  }

  getPageMeta(id: string): PageMeta | undefined {
    return this.journal.pages[id];
  }

  getCachedPage(id: string): PageData | undefined {
    return this.pageCache.get(id);
  }

  getTrash(): TrashedPage[] {
    return this.journal.trash;
  }

  async loadPage(id: string): Promise<PageData | null> {
    const cached = this.pageCache.get(id);
    if (cached) return cached;
    const meta = this.journal.pages[id];
    if (!meta) return null;
    const path = this.storage.pagePath(id);
    const result = await this.storage.readJson<unknown>(path);
    let page: PageData;
    if (result) {
      page = normalizePage(result.data, {
        id,
        title: meta.title,
        tabId: meta.tabId,
        number: this.getPageNumber(id),
        background: meta.background,
        kind: meta.kind,
      });
      if (result.recovered) {
        new Notice(`Fieldbook: page "${meta.title}" was recovered from backup.`);
      }
    } else {
      if (await this.storage.exists(path)) {
        const stamp = Date.now();
        try {
          await this.app.vault.adapter.rename(path, `${path}.corrupt-${stamp}`);
        } catch {
          /* keep the corrupt file in place if it cannot be moved */
        }
        new Notice(`Fieldbook: page "${meta.title}" was unreadable. A blank page was opened.`);
      }
      page = await this.buildPage(meta.tabId, meta.title, meta.kind, meta.background);
      page.id = id;
      page.createdAt = meta.createdAt;
      this.markPageDirty(id, false);
    }
    page.title = meta.title;
    page.tabId = meta.tabId;
    page.kind = meta.kind;
    page.background = meta.background;
    page.number = this.getPageNumber(id);
    this.pageCache.set(id, page);
    return page;
  }

  async getPageOrCreate(id: string): Promise<PageData | null> {
    return this.loadPage(id);
  }

  getLayout(): Spread[] {
    if (this.layoutCache) return this.layoutCache;
    const slots: { pageId: string | null; tabId: string }[] = [];
    for (const tab of this.journal.tabs) {
      for (const pageId of tab.pageIds) {
        if (this.journal.pages[pageId]) slots.push({ pageId, tabId: tab.id });
      }
    }
    const spreads: Spread[] = [];
    const fallbackTab = this.journal.tabs[0]?.id ?? "";
    if (!slots.length) {
      spreads.push({
        index: 0,
        tabId: fallbackTab,
        left: { pageId: null, number: 0, tabId: fallbackTab, side: "left" },
        right: { pageId: null, number: 0, tabId: fallbackTab, side: "right" },
      });
      this.layoutCache = spreads;
      return spreads;
    }
    if (slots.length % 2 === 1) {
      slots.push({ pageId: null, tabId: slots[slots.length - 1].tabId });
    }
    for (let i = 0; i < slots.length; i += 2) {
      const leftSlot = slots[i];
      const rightSlot = slots[i + 1];
      const left: SpreadSlot = {
        pageId: leftSlot.pageId,
        number: Math.floor(i / 2) * 2 + 1,
        tabId: leftSlot.tabId,
        side: "left",
      };
      const right: SpreadSlot = {
        pageId: rightSlot.pageId,
        number: Math.floor(i / 2) * 2 + 2,
        tabId: rightSlot.tabId,
        side: "right",
      };
      spreads.push({ index: spreads.length, tabId: leftSlot.tabId, left, right });
    }
    this.layoutCache = spreads;
    return spreads;
  }

  invalidateLayout(): void {
    this.layoutCache = null;
  }

  getPageNumber(id: string): number {
    for (const spread of this.getLayout()) {
      if (spread.left.pageId === id) return spread.left.number;
      if (spread.right.pageId === id) return spread.right.number;
    }
    return 0;
  }

  getSpreadIndexForPage(id: string): number {
    for (const spread of this.getLayout()) {
      if (spread.left.pageId === id || spread.right.pageId === id) return spread.index;
    }
    return 0;
  }

  getFirstSpreadForTab(tabId: string): number {
    const tab = this.getTab(tabId);
    const firstPageId = tab?.pageIds[0];
    if (firstPageId) return this.getSpreadIndexForPage(firstPageId);
    const found = this.getLayout().find(
      (spread) => spread.left.tabId === tabId || spread.right.tabId === tabId,
    );
    return found ? found.index : 0;
  }

  getToc(): TocEntry[] {
    const entries: TocEntry[] = [];
    for (const spread of this.getLayout()) {
      for (const slot of [spread.left, spread.right]) {
        if (!slot.pageId) continue;
        const meta = this.journal.pages[slot.pageId];
        if (!meta || meta.kind === "contents") continue;
        const tab = this.getTab(meta.tabId);
        entries.push({
          pageId: meta.id,
          number: slot.number,
          title: meta.title,
          tabId: meta.tabId,
          tabName: tab?.name ?? "",
          spreadIndex: spread.index,
        });
      }
    }
    return entries;
  }

  getPageCount(): number {
    return Object.keys(this.journal.pages).length;
  }

  async createPage(
    tabId: string,
    options: { title?: string; kind?: PageKind; background?: PageBackground; index?: number; select?: boolean } = {},
  ): Promise<PageData | null> {
    const tab = this.getTab(tabId);
    if (!tab) return null;
    const title = options.title?.trim() || this.suggestPageTitle(tab);
    const page = await this.buildPage(tabId, title, options.kind ?? "freeform", options.background);
    const index = options.index ?? tab.pageIds.length;
    tab.pageIds.splice(Math.min(index, tab.pageIds.length), 0, page.id);
    this.journal.pages[page.id] = this.metaFromPage(page);
    this.pageCache.set(page.id, page);
    this.layoutCache = null;
    this.markPageDirty(page.id, false);
    this.markJournalDirty();
    this.emit({ type: "structure" });
    return page;
  }

  async createContentsPage(tabId?: string): Promise<PageData | null> {
    const target = tabId ?? this.journal.tabs[0]?.id;
    if (!target) return null;
    return this.createPage(target, { title: "Contents", kind: "contents", index: 0 });
  }

  suggestPageTitle(tab: TabData): string {
    const used = new Set(tab.pageIds.map((id) => this.journal.pages[id]?.title));
    let index = tab.pageIds.length + 1;
    let title = `Page ${index}`;
    while (used.has(title)) {
      index++;
      title = `Page ${index}`;
    }
    return title;
  }

  async duplicatePage(id: string): Promise<PageData | null> {
    const source = await this.loadPage(id);
    const meta = this.journal.pages[id];
    if (!source || !meta) return null;
    const tab = this.getTab(meta.tabId);
    if (!tab) return null;
    const copy = JSON.parse(JSON.stringify(source)) as PageData;
    copy.id = uid("page");
    copy.title = `${meta.title} copy`;
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    copy.elements = copy.elements.map((el) => ({
      ...el,
      id: uid("el"),
      groupId: el.groupId ? uid("group") : null,
    }));
    const sourceIndex = tab.pageIds.indexOf(id);
    tab.pageIds.splice(sourceIndex + 1, 0, copy.id);
    this.journal.pages[copy.id] = this.metaFromPage(copy);
    this.pageCache.set(copy.id, copy);
    this.layoutCache = null;
    this.markPageDirty(copy.id, false);
    this.markJournalDirty();
    this.emit({ type: "structure" });
    return copy;
  }

  async deletePage(id: string): Promise<boolean> {
    const meta = this.journal.pages[id];
    if (!meta) return false;
    const tab = this.getTab(meta.tabId);
    const index = tab ? tab.pageIds.indexOf(id) : -1;
    if (tab && index >= 0) tab.pageIds.splice(index, 1);
    delete this.journal.pages[id];
    this.journal.trash.unshift({
      meta: { ...meta, updatedAt: nowIso() },
      deletedAt: nowIso(),
      previousTabId: meta.tabId,
      previousIndex: Math.max(0, index),
    });
    this.pageCache.delete(id);
    this.dirtyPages.delete(id);
    this.layoutCache = null;
    this.markJournalDirty();
    this.emit({ type: "structure" });
    return true;
  }

  async restorePage(trashIndex: number): Promise<PageData | null> {
    const entry = this.journal.trash[trashIndex];
    if (!entry) return null;
    let tab = this.getTab(entry.previousTabId);
    if (!tab) {
      tab = this.buildTab("Recovered", "sage", "archive");
      this.journal.tabs.push(tab);
    }
    const index = Math.min(entry.previousIndex, tab.pageIds.length);
    tab.pageIds.splice(index, 0, entry.meta.id);
    entry.meta.tabId = tab.id;
    this.journal.pages[entry.meta.id] = entry.meta;
    this.journal.trash.splice(trashIndex, 1);
    this.layoutCache = null;
    this.markJournalDirty();
    this.emit({ type: "structure" });
    return this.loadPage(entry.meta.id);
  }

  async permanentlyDeleteTrash(trashIndex: number): Promise<void> {
    const entry = this.journal.trash[trashIndex];
    if (!entry) return;
    await this.storage.remove(this.storage.pagePath(entry.meta.id));
    this.journal.trash.splice(trashIndex, 1);
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  async emptyTrash(): Promise<void> {
    for (const entry of this.journal.trash) {
      await this.storage.remove(this.storage.pagePath(entry.meta.id));
    }
    this.journal.trash = [];
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  movePage(id: string, targetTabId: string, index: number): boolean {
    const meta = this.journal.pages[id];
    if (!meta) return false;
    const target = this.getTab(targetTabId);
    if (!target) return false;
    const source = this.getTab(meta.tabId);
    if (source) {
      const at = source.pageIds.indexOf(id);
      if (at >= 0) source.pageIds.splice(at, 1);
    }
    const clamped = Math.max(0, Math.min(index, target.pageIds.length));
    target.pageIds.splice(clamped, 0, id);
    meta.tabId = target.id;
    meta.updatedAt = nowIso();
    const cached = this.pageCache.get(id);
    if (cached) cached.tabId = target.id;
    this.layoutCache = null;
    this.markPageDirty(id, false);
    this.markJournalDirty();
    this.emit({ type: "structure" });
    return true;
  }

  reorderPage(tabId: string, index: number, delta: number): void {
    const tab = this.getTab(tabId);
    if (!tab) return;
    const target = index + delta;
    if (index < 0 || index >= tab.pageIds.length || target < 0 || target >= tab.pageIds.length) return;
    const [id] = tab.pageIds.splice(index, 1);
    tab.pageIds.splice(target, 0, id);
    this.layoutCache = null;
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  renamePage(id: string, title: string): void {
    const meta = this.journal.pages[id];
    if (!meta) return;
    meta.title = title.trim() || "Untitled";
    meta.updatedAt = nowIso();
    const page = this.pageCache.get(id);
    if (page) {
      page.title = meta.title;
      page.updatedAt = meta.updatedAt;
    }
    this.markPageDirty(id, false);
    this.markJournalDirty();
    this.emit({ type: "page", pageId: id });
  }

  setPageBackground(id: string, background: PageBackground): void {
    const meta = this.journal.pages[id];
    if (!meta) return;
    meta.background = background;
    meta.updatedAt = nowIso();
    const page = this.pageCache.get(id);
    if (page) page.background = background;
    this.markPageDirty(id);
    this.markJournalDirty();
    this.emit({ type: "page", pageId: id });
  }

  addTab(name: string, color: TabColor = "cream", icon = "bookmark", withPage = true): TabData {
    const tab = this.buildTab(name.trim() || `Tab ${this.journal.tabs.length + 1}`, color, icon);
    this.journal.tabs.push(tab);
    this.markJournalDirty();
    this.emit({ type: "structure" });
    if (withPage) {
      void this.createPage(tab.id);
    }
    return tab;
  }

  renameTab(id: string, name: string): void {
    const tab = this.getTab(id);
    if (!tab) return;
    tab.name = name.trim() || tab.name;
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  setTabColor(id: string, color: TabColor): void {
    const tab = this.getTab(id);
    if (!tab) return;
    tab.color = color;
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  setTabIcon(id: string, icon: string): void {
    const tab = this.getTab(id);
    if (!tab) return;
    tab.icon = icon;
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  reorderTab(id: string, targetIndex: number): void {
    const index = this.journal.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [tab] = this.journal.tabs.splice(index, 1);
    const target = Math.max(0, Math.min(targetIndex, this.journal.tabs.length));
    this.journal.tabs.splice(target, 0, tab);
    this.layoutCache = null;
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  async deleteTab(id: string): Promise<void> {
    const index = this.journal.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [tab] = this.journal.tabs.splice(index, 1);
    for (const pageId of tab.pageIds) {
      const meta = this.journal.pages[pageId];
      if (!meta) continue;
      this.journal.trash.unshift({
        meta: { ...meta },
        deletedAt: nowIso(),
        previousTabId: tab.id,
        previousIndex: tab.pageIds.indexOf(pageId),
      });
      delete this.journal.pages[pageId];
      this.pageCache.delete(pageId);
      this.dirtyPages.delete(pageId);
    }
    if (!this.journal.tabs.length) {
      const newTab = this.buildTab("Journal", "cream", "bookmark");
      this.journal.tabs.push(newTab);
      const page = await this.buildPage(newTab.id, "Page 1", "freeform");
      newTab.pageIds.push(page.id);
      this.journal.pages[page.id] = this.metaFromPage(page);
      this.pageCache.set(page.id, page);
      this.markPageDirty(page.id, false);
    }
    this.layoutCache = null;
    this.markJournalDirty();
    this.emit({ type: "structure" });
  }

  setJournalTitle(title: string): void {
    this.journal.title = title.trim() || "Fieldbook";
    this.markJournalDirty();
    this.emit({ type: "journal" });
  }

  updateSettings(patch: Partial<JournalSettings>): void {
    this.journal.settings = {
      ...this.journal.settings,
      ...patch,
      brushes: patch.brushes ?? this.journal.settings.brushes,
    };
    this.markJournalDirty();
    this.emit({ type: "settings" });
  }

  updateBrushSettings(patch: Partial<JournalSettings["brushes"]>): void {
    this.journal.settings.brushes = { ...this.journal.settings.brushes, ...patch };
    this.markJournalDirty();
    this.emit({ type: "settings" });
  }

  updateVoiceSettings(patch: Partial<JournalSettings["voice"]>): void {
    this.journal.settings.voice = { ...this.journal.settings.voice, ...patch };
    this.markJournalDirty();
    this.emit({ type: "settings" });
  }

  markPageDirty(id: string, schedule = true): void {
    const meta = this.journal.pages[id];
    if (meta) meta.updatedAt = nowIso();
    const page = this.pageCache.get(id);
    if (page) page.updatedAt = nowIso();
    this.dirtyPages.add(id);
    if (schedule) this.scheduleSave();
  }

  markJournalDirty(schedule = true): void {
    this.journal.updatedAt = nowIso();
    this.journalDirty = true;
    if (schedule) this.scheduleSave();
  }

  scheduleSave(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    const delay = this.journal?.settings.autosaveDelay ?? 800;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.saveChain = this.saveChain.then(() => this.doFlush());
    return this.saveChain;
  }

  private async doFlush(): Promise<void> {
    const pageIds = Array.from(this.dirtyPages);
    this.dirtyPages.clear();
    const journalDirty = this.journalDirty;
    this.journalDirty = false;
    try {
      for (const id of pageIds) {
        const page = this.pageCache.get(id);
        const meta = this.journal.pages[id];
        if (!page || !meta) continue;
        page.title = meta.title;
        page.tabId = meta.tabId;
        page.kind = meta.kind;
        page.background = meta.background;
        page.number = this.getPageNumber(id);
        page.updatedAt = meta.updatedAt;
        await this.storage.writeJson(this.storage.pagePath(id), page);
      }
      if (journalDirty || pageIds.length) {
        this.journal.updatedAt = nowIso();
        await this.storage.writeJson(this.storage.journalPath, this.journal, true);
      }
    } catch (error) {
      for (const id of pageIds) this.dirtyPages.add(id);
      if (journalDirty) this.journalDirty = true;
      console.error("Fieldbook: save failed", error);
      new Notice("Fieldbook: could not save the notebook. Your changes are kept in memory.");
    }
  }

  async attachmentRenamed(oldPath: string, newPath: string): Promise<boolean> {
    let touched = false;
    for (const [id, page] of this.pageCache) {
      let pageTouched = false;
      for (const el of page.elements) {
        if (el.type === "image" && el.attachment === oldPath) {
          el.attachment = newPath;
          pageTouched = true;
        }
      }
      if (pageTouched) {
        this.markPageDirty(id);
        touched = true;
      }
    }
    if (touched) this.emit({ type: "page" });
    return touched;
  }

  async findPagesUsingAttachment(path: string): Promise<string[]> {
    const result: string[] = [];
    for (const [id, page] of this.pageCache) {
      if (page.elements.some((el) => el.type === "image" && el.attachment === path)) {
        result.push(id);
      }
    }
    return result;
  }

  async renameAttachment(oldPath: string, newPath: string): Promise<void> {
    await this.attachmentRenamed(oldPath, newPath);
  }
}
