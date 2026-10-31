import {
  ItemView,
  Menu,
  Notice,
  TFile,
  type WorkspaceLeaf,
  setIcon,
} from "obsidian";
import type {
  ActiveTool,
  BrushKind,
  DecorKind,
  ImageElement,
  PageBackground,
  PageElement,
  PageMeta,
  PluginSettings,
  ShapeKind,
  Side,
  SoundCategory,
  TabColor,
  TabData,
} from "../types";
import { TAB_COLOR_OPTIONS, VIEW_TYPE } from "../types";
import type { JournalManager, StoreEvent } from "../core/JournalManager";
import { UndoRedoManager } from "../core/History";
import type { AudioManager } from "../audio/AudioManager";
import type { StorageManager } from "../storage/StorageManager";
import { PageView, type PageHost, type ShapeStyle, type ToolState } from "../page/PageView";
import { applyTheme, type PaperTone } from "../themes";
import { isTypingTarget, parseWikiLink, physicalKey } from "../utils";
import { saveImageFile } from "../utils/images";
import { Toolbar, type ToolbarActions } from "../ui/Toolbar";
import { TabsBar } from "../ui/TabsBar";
import { InspectorBar } from "../ui/InspectorBar";
import { openLayersPanel } from "../ui/LayersPanel";
import { openPopover, popoverHeading, popoverItem } from "../ui/Popover";
import { PromptModal, ConfirmModal, ImagePickerModal, FilePickerModal } from "../ui/BasicModals";
import { CropModal } from "../ui/CropModal";
import { PageManagerModal } from "../ui/PageManagerModal";
import { BookSettingsModal } from "../ui/BookSettingsModal";
import { importMarkdown } from "../export/MarkdownImporter";
import { exportPageToMarkdown } from "../export/MarkdownExporter";
import { renderPageToCanvas, safeExportName, saveCanvasPng } from "../export/PageSnapshot";

export interface FieldbookPluginLike {
  app: import("obsidian").App;
  store: JournalManager;
  storage: StorageManager;
  audio: AudioManager;
  settings: PluginSettings;
  saveSettings: () => Promise<void>;
  openPluginSettings: () => void;
  changeDataFolder: (folder: string) => Promise<void>;
  updateStorageFolders: (
    patch: Partial<Pick<PluginSettings, "attachmentsFolder" | "exportsFolder">>,
  ) => Promise<void>;
}

interface ViewPages {
  left: PageView | null;
  right: PageView | null;
}

type Direction = "forward" | "backward";

const TAB_ICONS = [
  "bookmark",
  "book-open",
  "file-text",
  "flask-conical",
  "map",
  "compass",
  "camera",
  "music",
  "archive",
  "star",
  "leaf",
  "scroll",
];

export class FieldbookView extends ItemView implements PageHost {
  readonly plugin: FieldbookPluginLike;
  readonly store: JournalManager;
  readonly audio: AudioManager;
  readonly history: UndoRedoManager;

  private rootEl!: HTMLElement;
  private stageEl!: HTMLElement;
  private bookAreaEl!: HTMLElement;
  private bookEl!: HTMLElement;
  private pagesEl!: HTMLElement;
  private leftSlot!: HTMLElement;
  private rightSlot!: HTMLElement;
  private tabsHost!: HTMLElement;
  private titleButton!: HTMLButtonElement;
  private topbarMeta!: HTMLElement;
  private soundButton!: HTMLButtonElement;
  private focusButton!: HTMLButtonElement;
  private footerEl!: HTMLElement;
  private footerPrev!: HTMLButtonElement;
  private footerNext!: HTMLButtonElement;
  private footerRange!: HTMLElement;
  private footerTab!: HTMLElement;
  private turnPrev!: HTMLButtonElement;
  private turnNext!: HTMLButtonElement;

  private toolbar!: Toolbar;
  private inspector!: InspectorBar;
  private tabsBar!: TabsBar;
  private toastEl: HTMLElement | null = null;
  private toastTimer: number | null = null;

  pageViews: ViewPages = { left: null, right: null };
  activePageView: PageView | null = null;
  private currentSpread = 0;
  private activeSide: Side = "left";
  private pendingActiveSide: Side | null = null;
  private activeTabId: string | null = null;
  private lastSpreadByTab = new Map<string, number>();
  private pageScale = 0.5;
  private focusMode = false;
  private destroyed = false;
  private closing = false;
  private flipping = false;
  private flipCleanup: (() => Promise<void>) | null = null;
  private renderToken = 0;
  private structureTimer: number | null = null;
  private suppressStructureRender = false;
  private resizeObserver: ResizeObserver | null = null;
  private measureFrame: number | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private clipboard: PageElement[] = [];
  private fileInput: HTMLInputElement | null = null;
  private paperTextureReady: Promise<void> = Promise.resolve();
  private readonly paperTones = new Map<string, PaperTone>();

  private tool: ActiveTool = "select";
  private brush: BrushKind | "eraser" = "pen";
  private shape: ShapeKind = "rect";
  private decor: DecorKind = "tape";
  private shapeStyle: ShapeStyle = {
    stroke: "ink",
    fill: "none",
    strokeWidth: 3,
    dashed: false,
    sides: 5,
  };
  private lastDisplayKey = "";

  constructor(leaf: WorkspaceLeaf, plugin: FieldbookPluginLike) {
    super(leaf);
    this.plugin = plugin;
    this.store = plugin.store;
    this.audio = plugin.audio;
    this.history = new UndoRedoManager(() => this.toolbar?.update());
    const brushes = this.store.getSettings().brushes;
    this.brush = brushes.activeBrush ?? "pen";
    this.shapeStyle.stroke = brushes.activeColor || "ink";
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Fieldbook";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("fieldbook-view-host");
    this.rootEl = this.contentEl.createDiv({ cls: "fieldbook-root" });
    this.rootEl.tabIndex = 0;
    this.buildChrome();
    this.toolbar = new Toolbar(this.rootEl, this.createToolbarActions());
    this.inspector = new InspectorBar(this.rootEl, {
      onCopy: () => this.copySelection(),
      onCrop: (image) => this.openCrop(this.activePageOrNull(), image),
      onTape: (image) => this.activePageView?.addTapeToImage(image),
      refresh: () => {
        this.refreshInspector();
        this.toolbar.update();
      },
    });
    this.tabsBar = new TabsBar(this.tabsHost, {
      getTabs: () => this.store.getTabs(),
      getActiveTabId: () => this.activeTabId,
      getTheme: () => this.store.getSettings().theme,
      onSelect: (tabId) => {
        this.audio.play("tabs");
        const tab = this.store.getTab(tabId);
        const firstPage = tab?.pageIds[0];
        if (firstPage) {
          this.navigateToPage(firstPage);
        } else {
          void this.addPage(tabId);
        }
      },
      onAdd: () => this.promptNewTab(),
      onContextMenu: (event, tab) => this.openTabMenu(event, tab),
      onReorder: (tabId, targetIndex) => {
        this.store.reorderTab(tabId, targetIndex);
      },
    });

    this.applyJournalTheme();
    this.lastDisplayKey = this.displayKey();
    this.bindViewEvents();

    this.unsubscribeStore = this.store.onChange((event) => this.handleStoreEvent(event));

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension.match(/^(png|jpe?g|webp|gif|svg|avif|bmp)$/i)) {
          void this.store.attachmentRenamed(oldPath, file.path).then((touched) => {
            if (touched) {
              this.pageViews.left?.externalPageChanged();
              this.pageViews.right?.externalPageChanged();
              this.refreshInspector();
            }
          });
        }
      }),
    );

    this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
    this.resizeObserver.observe(this.bookAreaEl);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    this.measureBook();
    await this.renderSpreadNow(0);
    this.updateChrome();
    window.setTimeout(() => this.rootEl.focus({ preventScroll: true }), 70);
  }

  async onClose(): Promise<void> {
    this.closing = true;
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (this.structureTimer !== null) window.clearTimeout(this.structureTimer);
    if (this.measureFrame !== null) window.cancelAnimationFrame(this.measureFrame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.flipCleanup) {
      await this.flipCleanup();
      this.flipCleanup = null;
    }
    this.destroyPageViews();
    this.toolbar?.destroy();
    this.inspector?.destroy();
    this.tabsBar?.destroy();
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.setFocusMode(false, { silent: true });
    this.history.clear();
    await this.store.flush();
    this.contentEl.empty();
    this.destroyed = true;
  }

  // ---------------------------------------------------------------------
  // Chrome
  // ---------------------------------------------------------------------

  private buildChrome(): void {
    const topbar = this.rootEl.createDiv({ cls: "fb-topbar" });
    const brand = topbar.createDiv({ cls: "fb-topbar__brand" });
    const mark = brand.createSpan({ cls: "fb-topbar__mark" });
    setIcon(mark, "book-open");
    this.titleButton = brand.createEl("button", { cls: "fb-topbar__title", text: this.store.journal.title });
    this.titleButton.title = "Rename notebook";
    this.titleButton.addEventListener("click", () => this.promptNotebookTitle());
    this.topbarMeta = brand.createSpan({ cls: "fb-topbar__meta" });
    const actions = topbar.createDiv({ cls: "fb-topbar__actions" });
    this.soundButton = this.topButton(actions, "volume-x", "Toggle sound", () => this.toggleSound());
    this.focusButton = this.topButton(actions, "maximize", "Focus mode", () => this.toggleFocusMode());
    this.topButton(actions, "settings", "Notebook settings", () => this.openBookSettings());

    this.stageEl = this.rootEl.createDiv({ cls: "fb-stage" });
    this.bookAreaEl = this.stageEl.createDiv({ cls: "fb-book-area" });
    this.bookEl = this.bookAreaEl.createDiv({ cls: "fb-book" });
    const cover = this.bookEl.createDiv({ cls: "fb-book__cover" });
    const coverSpine = this.bookEl.createDiv({ cls: "fb-book__cover-spine" });
    void cover;
    void coverSpine;
    this.tabsHost = this.bookEl.createDiv({ cls: "fb-tabs-host" });
    this.pagesEl = this.bookEl.createDiv({ cls: "fb-pages" });
    this.leftSlot = this.pagesEl.createDiv({ cls: "fb-page-slot fb-page-slot--left" });
    this.rightSlot = this.pagesEl.createDiv({ cls: "fb-page-slot fb-page-slot--right" });
    const spine = this.pagesEl.createDiv({ cls: "fb-spine" });
    void spine;
    const stackLeft = this.pagesEl.createDiv({ cls: "fb-page-stack fb-page-stack--left" });
    const stackRight = this.pagesEl.createDiv({ cls: "fb-page-stack fb-page-stack--right" });
    void stackLeft;
    void stackRight;
    this.turnPrev = this.turnButton("chevron-left", "Previous spread", () => this.turnPage(-1));
    this.turnPrev.addClass("fb-turn--left");
    this.turnNext = this.turnButton("chevron-right", "Next spread", () => this.turnPage(1));
    this.turnNext.addClass("fb-turn--right");
    this.pagesEl.append(this.turnPrev, this.turnNext);

    this.footerEl = this.rootEl.createDiv({ cls: "fb-footer" });
    const nav = this.footerEl.createDiv({ cls: "fb-footer__nav" });
    this.footerPrev = nav.createEl("button", { cls: "fb-footer__button" });
    this.footerPrev.setAttribute("aria-label", "Previous spread");
    setIcon(this.footerPrev, "chevron-left");
    this.footerPrev.addEventListener("click", () => this.turnPage(-1));
    const indicator = nav.createEl("button", { cls: "fb-footer__indicator" });
    indicator.title = "Notebook map";
    indicator.addEventListener("click", () => this.openPageManager());
    const indicatorTop = indicator.createDiv({ cls: "fb-footer__range" });
    this.footerRange = indicatorTop;
    this.footerTab = indicator.createDiv({ cls: "fb-footer__tab" });
    this.footerNext = nav.createEl("button", { cls: "fb-footer__button" });
    this.footerNext.setAttribute("aria-label", "Next spread");
    setIcon(this.footerNext, "chevron-right");
    this.footerNext.addEventListener("click", () => this.turnPage(1));
    const addPage = this.footerEl.createEl("button", { cls: "fb-footer__add" });
    addPage.title = "Add a page";
    const addIcon = addPage.createSpan();
    setIcon(addIcon, "file-plus");
    addPage.createSpan({ text: "New page" });
    addPage.addEventListener("click", () => void this.addPage());
    this.updateSoundButton();
  }

  private topButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "fb-topbar__button" });
    button.title = label;
    button.setAttribute("aria-label", label);
    const iconEl = button.createSpan();
    setIcon(iconEl, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private turnButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = this.pagesEl.createEl("button", { cls: "fb-turn" });
    button.title = label;
    button.setAttribute("aria-label", label);
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private createToolbarActions(): ToolbarActions {
    return {
      getTool: () => this.getTool(),
      onTool: (tool) => this.setTool(tool),
      onBrush: (brush) => this.setBrush(brush),
      onBrushPatch: (patch) => this.patchBrush(patch),
      onEraserSize: (value) => {
        this.store.updateBrushSettings({ eraserSize: value });
        this.toolbar.update();
      },
      onShape: (shape) => {
        this.shape = shape;
        this.tool = "shape";
        this.refreshToolState();
      },
      onDecor: (kind) => {
        this.decor = kind;
        this.tool = "decorate";
        this.refreshToolState();
      },
      onImageUpload: () => this.pickLocalImages(),
      onImageVault: () => this.pickVaultImage(),
      onUndo: () => void this.undo(),
      onRedo: () => void this.redo(),
      canUndo: () => this.history.canUndo(),
      canRedo: () => this.history.canRedo(),
      onLayers: (anchor) => this.openLayers(anchor),
      onPages: () => this.openPageManager(),
      onExport: (anchor) => this.openExportMenu(anchor),
      onImport: () => this.pickMarkdownFile(),
      onSettings: () => this.openBookSettings(),
      onFocus: () => this.toggleFocusMode(),
    };
  }

  private bindViewEvents(): void {
    this.registerDomEvent(this.rootEl, "keydown", this.onKeyDown);
    this.registerDomEvent(window, "keydown", this.onFocusEscape, true);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.focusMode) return;
        if (this.app.workspace.getActiveViewOfType(FieldbookView) === this) return;
        this.setFocusMode(false, { silent: true });
      }),
    );
    this.registerDomEvent(this.rootEl, "paste", this.onPaste);
    this.registerDomEvent(this.rootEl, "dragover", this.onDragOver);
    this.registerDomEvent(this.rootEl, "dragleave", this.onDragLeave);
    this.registerDomEvent(this.rootEl, "drop", this.onDrop);
    this.registerDomEvent(this.rootEl, "pointerdown", (event) => {
      this.audio.unlock();
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      if (this.activePageView?.isEditing()) return;
      this.rootEl.focus({ preventScroll: true });
    });
    this.registerEvent(
      this.app.workspace.on("quit", (tasks) => {
        tasks.add(async () => {
          this.pageViews.left?.commitPending();
          this.pageViews.right?.commitPending();
          await this.store.flush();
        });
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Layout and navigation
  // ---------------------------------------------------------------------

  private scheduleMeasure(): void {
    if (this.measureFrame !== null) return;
    this.measureFrame = window.requestAnimationFrame(() => {
      this.measureFrame = null;
      this.measureBook();
    });
  }

  private measureBook(): void {
    if (this.destroyed || !this.bookAreaEl) return;
    const rect = this.bookAreaEl.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;
    const settings = this.store.getSettings();
    const ratio = settings.pageWidth / settings.pageHeight;
    const availW = Math.max(320, rect.width - 16);
    const availH = Math.max(320, rect.height - 12);
    const coverX = 36;
    const coverY = 38;
    const tabSpace = 52;
    const fitW = Math.min((availW - coverX) / 2, (availH - coverY - tabSpace) * ratio);
    const bookScale = Math.max(0.5, Math.min(1, settings.bookScale ?? 1));
    const pageW = Math.max(160, fitW * bookScale);
    const pageH = pageW / ratio;
    this.bookEl.style.width = `${Math.round(pageW * 2)}px`;
    this.bookEl.style.height = `${Math.round(pageH)}px`;
    const rootRect = this.rootEl.getBoundingClientRect();
    const bookRect = this.bookEl.getBoundingClientRect();
    const bookLeft = bookRect.left - rootRect.left;
    const railLeft = Math.max(12, Math.min(bookLeft - 60, rootRect.width - 70));
    this.rootEl.style.setProperty("--fb-rail-left", `${Math.round(railLeft)}px`);
    const scale = pageW / settings.pageWidth;
    if (Math.abs(scale - this.pageScale) > 0.0005) {
      this.pageScale = scale;
      this.pageViews.left?.setScale(scale);
      this.pageViews.right?.setScale(scale);
    } else {
      this.pageScale = scale;
    }
  }

  private async renderSpreadNow(index: number, allowDuringFlip = false): Promise<void> {
    if ((this.flipping && !allowDuringFlip) || this.destroyed) return;
    const token = ++this.renderToken;
    const layout = this.store.getLayout();
    if (!layout.length) {
      this.destroyPageViews();
      this.updateChrome();
      return;
    }
    const clamped = Math.max(0, Math.min(index, layout.length - 1));
    const spread = layout[clamped];
    this.currentSpread = spread.index;
    this.activeTabId = spread.tabId;
    this.lastSpreadByTab.set(spread.tabId, spread.index);
    this.destroyPageViews();
    this.leftSlot.replaceChildren();
    this.rightSlot.replaceChildren();
    if (!this.pageScale) this.measureBook();
    const scale = this.pageScale || 0.5;
    const left = new PageView(this, {
      pageId: spread.left.pageId,
      side: "left",
      number: spread.left.number,
    });
    const right = new PageView(this, {
      pageId: spread.right.pageId,
      side: "right",
      number: spread.right.number,
    });
    this.pageViews = { left, right };
    await Promise.all([left.mount(this.leftSlot, scale), right.mount(this.rightSlot, scale)]);
    if (token !== this.renderToken || this.destroyed) {
      left.destroy();
      right.destroy();
      return;
    }
    const desiredSide = this.pendingActiveSide ?? this.activeSide;
    this.pendingActiveSide = null;
    let target = desiredSide === "right" ? right : left;
    if (!target.page) target = target === left ? right : left;
    this.activeTabId = target.page?.tabId ?? spread.tabId;
    this.setActivePageView(target.page ? target : null, false);
    this.updateChrome();
    this.refreshInspector();
    this.updateCursors();
  }

  private destroyPageViews(): void {
    this.pageViews.left?.destroy();
    this.pageViews.right?.destroy();
    this.pageViews = { left: null, right: null };
    this.activePageView = null;
    this.inspector?.clear();
  }

  private setActivePageView(view: PageView | null, clearOther = true): void {
    if (view && view.staticMode) return;
    if (clearOther && this.activePageView && this.activePageView !== view) {
      this.activePageView.clearSelection(false);
    }
    this.activePageView = view;
    this.pageViews.left?.root.toggleClass("is-active", view === this.pageViews.left);
    this.pageViews.right?.root.toggleClass("is-active", view === this.pageViews.right);
    if (view) {
      this.activeSide = view.side;
      if (view.page) this.activeTabId = view.page.tabId;
    }
    this.tabsBar?.render();
    this.updateFooter();
    this.refreshInspector();
  }

  activatePage(page: PageView): void {
    if (page.staticMode) return;
    if (this.activePageView === page) return;
    this.setActivePageView(page, true);
  }

  private async navigateToSpread(target: number, animate = true): Promise<void> {
    const layout = this.store.getLayout();
    if (!layout.length || this.flipping) return;
    const clamped = Math.max(0, Math.min(target, layout.length - 1));
    if (clamped === this.currentSpread) {
      this.updateChrome();
      return;
    }
    const direction: Direction = clamped > this.currentSpread ? "forward" : "backward";
    const settings = this.store.getSettings();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && settings.flipAnimation && !reduceMotion && settings.flipDuration >= 140) {
      try {
        await this.flipTo(clamped, direction);
        return;
      } catch (error) {
        console.error("Fieldbook: page turn failed", error);
      }
    }
    this.audio.play("page");
    await this.renderSpreadNow(clamped);
  }

  private turnPage(delta: number): void {
    if (this.flipping) return;
    const layout = this.store.getLayout();
    const next = this.currentSpread + delta;
    if (next < 0 || next >= layout.length) return;
    void this.navigateToSpread(next, true);
  }

  navigateToPage(pageId: string): void {
    if (!pageId) return;
    const layout = this.store.getLayout();
    for (const spread of layout) {
      if (spread.left.pageId === pageId) {
        this.pendingActiveSide = "left";
        this.goToSpreadAndPage(spread.index);
        return;
      }
      if (spread.right.pageId === pageId) {
        this.pendingActiveSide = "right";
        this.goToSpreadAndPage(spread.index);
        return;
      }
    }
  }

  private goToSpreadAndPage(index: number): void {
    if (index === this.currentSpread && !this.flipping) {
      const side = this.pendingActiveSide;
      const spread = this.store.getLayout()[index];
      const expectedId = side === "right" ? spread?.right.pageId : spread?.left.pageId;
      const view = side === "right" ? this.pageViews.right : side === "left" ? this.pageViews.left : null;
      if (view?.page && view.pageId === expectedId) {
        this.pendingActiveSide = null;
        this.setActivePageView(view, true);
        this.updateChrome();
        return;
      }
      const pendingSide = this.pendingActiveSide;
      void this.renderSpreadNow(index).then(() => {
        if (this.destroyed || this.closing) return;
        this.pendingActiveSide = null;
        const mounted = pendingSide === "right" ? this.pageViews.right : this.pageViews.left;
        if (mounted?.page) this.setActivePageView(mounted, true);
        else this.updateChrome();
      });
      return;
    }
    if (this.structureTimer !== null) {
      window.clearTimeout(this.structureTimer);
      this.structureTimer = null;
    }
    void this.navigateToSpread(index, true);
  }

  private async addPage(tabId?: string): Promise<void> {
    const layout = this.store.getLayout();
    const targetTab =
      tabId ??
      layout[this.currentSpread]?.tabId ??
      this.activeTabId ??
      this.store.getTabs()[0]?.id;
    if (!targetTab) {
      this.promptNewTab(true);
      return;
    }
    const page = await this.store.createPage(targetTab);
    if (!page) return;
    this.audio.play("objects");
    this.navigateToPage(page.id);
  }

  private promptNewTab(navigate = true): void {
    new PromptModal(this.app, {
      title: "New tab",
      label: "Tab name",
      placeholder: "Field notes",
      onSubmit: (name) => {
        const tab = this.store.addTab(name || "New tab");
        window.setTimeout(() => {
          const created = this.store.getTab(tab.id);
          if (!created) return;
          this.audio.play("tabs");
          if (navigate) {
            const firstPage = created.pageIds[0];
            if (firstPage) setTimeout(() => this.navigateToPage(firstPage), 60);
          }
        }, 120);
      },
    }).open();
  }

  private promptNotebookTitle(): void {
    new PromptModal(this.app, {
      title: "Notebook title",
      value: this.store.journal.title,
      onSubmit: (value) => this.store.setJournalTitle(value),
    }).open();
  }

  // ---------------------------------------------------------------------
  // Page turn animation
  // ---------------------------------------------------------------------

  private async flipTo(targetIndex: number, direction: Direction): Promise<void> {
    const layout = this.store.getLayout();
    const from = layout[this.currentSpread];
    const to = layout[targetIndex];
    if (!from || !to) {
      this.audio.play("page");
      await this.renderSpreadNow(targetIndex);
      return;
    }
    this.flipping = true;
    this.rootEl.addClass("is-flipping");
    const staticViews: PageView[] = [];
    const stage = document.createElement("div");
    stage.className = "fb-flip-stage";
    const underlay = document.createElement("div");
    underlay.className = "fb-flip-underlay";
    const sheetHost = document.createElement("div");
    sheetHost.className = "fb-flip-sheet-host";
    const sheet = document.createElement("div");
    sheet.className = `fb-flip-sheet fb-flip-sheet--${direction}`;
    stage.style.visibility = "hidden";
    sheetHost.appendChild(sheet);
    stage.append(underlay, sheetHost);
    this.pagesEl.appendChild(stage);

    const makeSlot = (parent: HTMLElement, side: Side, pageId: string | null, number: number): Promise<void> => {
      const wrap = parent.createDiv({ cls: `fb-flip-slot fb-flip-slot--${side}` });
      const view = new PageView(this, {
        pageId,
        side,
        number,
        staticMode: true,
      });
      staticViews.push(view);
      return view.mount(wrap, this.pageScale);
    };

    let cleaned = false;
    const cleanup = async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      for (const view of staticViews) view.destroy();
      stage.remove();
      this.rootEl.removeClass("is-flipping");
      this.flipping = false;
      if (this.flipCleanup === cleanup) this.flipCleanup = null;
    };
    this.flipCleanup = cleanup;

    const underlayLeft = underlay.createDiv({ cls: "fb-flip-underlay__left" });
    const underlayRight = underlay.createDiv({ cls: "fb-flip-underlay__right" });
    const front = sheet.createDiv({ cls: "fb-flip-face fb-flip-face--front" });
    const back = sheet.createDiv({ cls: "fb-flip-face fb-flip-face--back" });

    if (direction === "forward") {
      await Promise.all([
        makeSlot(underlayLeft, "left", from.left.pageId, from.left.number),
        makeSlot(underlayRight, "right", to.right.pageId, to.right.number),
        makeSlot(front, "right", from.right.pageId, from.right.number),
        makeSlot(back, "left", to.left.pageId, to.left.number),
      ]);
    } else {
      await Promise.all([
        makeSlot(underlayLeft, "left", to.left.pageId, to.left.number),
        makeSlot(underlayRight, "right", from.right.pageId, from.right.number),
        makeSlot(front, "left", from.left.pageId, from.left.number),
        makeSlot(back, "right", to.right.pageId, to.right.number),
      ]);
    }

    const paint = new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
    await Promise.all([paint, this.paperTextureReady, ...staticViews.map((view) => view.whenPainted())]);
    if (this.closing || this.destroyed) {
      await cleanup();
      return;
    }

    const faceShades = Array.from(sheet.querySelectorAll<HTMLElement>(".fb-flip-face"));
    faceShades.forEach((face) => {
      const shade = document.createElement("div");
      shade.className = "fb-flip-shade";
      face.appendChild(shade);
    });
    const underlayShades = [
      underlayLeft.createDiv({ cls: "fb-flip-underlay__shade fb-flip-underlay__shade--left" }),
      underlayRight.createDiv({ cls: "fb-flip-underlay__shade fb-flip-underlay__shade--right" }),
    ];
    stage.style.visibility = "";
    const duration = Math.max(150, this.store.getSettings().flipDuration);
    const endAngle = direction === "forward" ? -180 : 180;
    this.audio.play("page");
    const animation = sheet.animate(
      [
        { transform: "rotateY(0deg) translateZ(0px)", offset: 0 },
        { transform: `rotateY(${endAngle * 0.04}deg) translateZ(4px)`, offset: 0.08 },
        { transform: `rotateY(${endAngle * 0.5}deg) translateZ(18px)`, offset: 0.5 },
        { transform: `rotateY(${endAngle * 0.96}deg) translateZ(3px)`, offset: 0.92 },
        { transform: `rotateY(${endAngle}deg) translateZ(0px)`, offset: 1 },
      ],
      { duration, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards" },
    );
    sheet.querySelectorAll<HTMLElement>(".fb-flip-shade").forEach((shade) => {
      shade.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0.4, offset: 0.5 },
          { opacity: 0, offset: 1 },
        ],
        { duration, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards" },
      );
    });
    underlayShades.forEach((shade) => {
      shade.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0.2, offset: 0.5 },
          { opacity: 0.26, offset: 0.78 },
          { opacity: 0, offset: 1 },
        ],
        { duration, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards" },
      );
    });
    try {
      try {
        await animation.finished;
      } catch {
        /* animation can be cancelled when the view closes */
      }
      if (!this.closing && !this.destroyed) {
        await this.renderSpreadNow(targetIndex, true);
        const painted = Promise.all(
          [this.pageViews.left?.whenPainted(), this.pageViews.right?.whenPainted()].filter(
            (paintPage): paintPage is Promise<void> => Boolean(paintPage),
          ),
        );
        const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 800));
        await Promise.race([painted, timeout]);
      }
    } finally {
      await cleanup();
    }
  }

  // ---------------------------------------------------------------------
  // Store events and settings
  // ---------------------------------------------------------------------

  private handleStoreEvent(event: StoreEvent): void {
    if (this.destroyed || this.closing) return;
    if (event.type === "settings") {
      this.applyJournalTheme();
      this.toolbar?.update();
      if (!this.flipping) this.measureBook();
      if (this.displayKey() !== this.lastDisplayKey && !this.flipping) {
        this.lastDisplayKey = this.displayKey();
        void this.renderSpreadNow(this.currentSpread);
      }
      return;
    }
    if (event.type === "journal") {
      this.updateChrome();
      return;
    }
    if (event.type === "page") {
      const pageId = event.pageId;
      if (!pageId) {
        this.pageViews.left?.refreshMeta();
        this.pageViews.right?.refreshMeta();
      } else {
        const view = [this.pageViews.left, this.pageViews.right].find(
          (candidate) => candidate && candidate.pageId === pageId,
        );
        view?.refreshMeta();
      }
      this.refreshInspector();
      return;
    }
    if (event.type === "structure") {
      if (this.suppressStructureRender) return;
      if (this.structureTimer !== null) window.clearTimeout(this.structureTimer);
      this.structureTimer = window.setTimeout(() => {
        this.structureTimer = null;
        if (this.destroyed || this.closing) return;
        void this.renderSpreadNow(this.currentSpread);
      }, 70);
    }
  }

  private displayKey(): string {
    const s = this.store.getSettings();
    return [
      s.theme,
      s.pageWidth,
      s.pageHeight,
      s.showPageNumbers,
      s.titleFont,
      s.bodyFont,
      s.customPaperTexture,
    ].join("|");
  }

  private applyJournalTheme(): void {
    const settings = this.store.getSettings();
    let paperTextureUrl = "";
    const path = settings.customPaperTexture.trim();
    if (path) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) paperTextureUrl = this.app.vault.adapter.getResourcePath(path);
    }
    applyTheme(this.rootEl, settings.theme, {
      titleFont: settings.titleFont,
      bodyFont: settings.bodyFont,
      paperTextureUrl,
      paperTone: paperTextureUrl ? this.paperTones.get(paperTextureUrl) ?? null : null,
    });
    this.paperTextureReady = Promise.resolve();
    if (!paperTextureUrl) return;
    const image = new Image();
    this.paperTextureReady = new Promise<void>((resolve) => {
      image.onload = () => {
        const tone = this.paperToneFor(image);
        this.paperTones.set(paperTextureUrl, tone);
        const current = this.store.getSettings();
        if (
          !this.destroyed &&
          !this.closing &&
          this.rootEl.isConnected &&
          current.customPaperTexture.trim() === path
        ) {
          applyTheme(this.rootEl, current.theme, {
            titleFont: current.titleFont,
            bodyFont: current.bodyFont,
            paperTextureUrl,
            paperTone: tone,
          });
        }
        resolve();
      };
      image.onerror = () => resolve();
    });
    image.src = paperTextureUrl;
  }

  private paperToneFor(image: HTMLImageElement): PaperTone {
    try {
      const size = 24;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return "light";
      context.drawImage(image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        total += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      }
      return total / (pixels.length / 4) >= 132 ? "light" : "dark";
    } catch {
      // Tainted canvases cannot be sampled; paper textures are usually light.
      return "light";
    }
  }

  private updateChrome(): void {
    if (!this.rootEl) return;
    this.titleButton?.setText(this.store.journal.title);
    if (this.topbarMeta) {
      const pages = this.store.getPageCount();
      const tabs = this.store.getTabs().length;
      this.topbarMeta.setText(`${pages} page${pages === 1 ? "" : "s"} \u00b7 ${tabs} tab${tabs === 1 ? "" : "s"}`);
    }
    this.tabsBar?.render();
    this.updateFooter();
    this.updateSoundButton();
    this.focusButton?.toggleClass("is-active", this.focusMode);
  }

  private updateFooter(): void {
    if (!this.footerRange) return;
    const layout = this.store.getLayout();
    const spread = layout[this.currentSpread];
    if (spread) {
      const left = spread.left.number;
      const right = spread.right.number;
      if (left && right) this.footerRange.setText(`Pages ${left}\u2013${right}`);
      else if (left || right) this.footerRange.setText(`Page ${left || right}`);
      else this.footerRange.setText("Blank spread");
      const tab = this.store.getTab(this.activePageView?.page?.tabId ?? spread.tabId);
      this.footerTab.setText(tab?.name ?? "");
    } else {
      this.footerRange.setText("No pages");
      this.footerTab.setText("");
    }
    const atStart = this.currentSpread <= 0;
    const atEnd = this.currentSpread >= layout.length - 1;
    this.footerPrev.disabled = atStart;
    this.footerNext.disabled = atEnd;
    this.turnPrev.toggleClass("is-hidden", atStart);
    this.turnNext.toggleClass("is-hidden", atEnd);
  }

  // ---------------------------------------------------------------------
  // Tools and cursors
  // ---------------------------------------------------------------------

  getTool(): ToolState {
    const brushes = this.store.getSettings().brushes;
    const brush = this.brush;
    const brushSettings = brush === "eraser" ? brushes.pen : brushes[brush];
    return {
      tool: this.tool,
      brush,
      brushSettings,
      eraserSize: brushes.eraserSize,
      shape: this.shape,
      decor: this.decor,
      shapeStyle: this.shapeStyle,
    };
  }

  private setTool(tool: ActiveTool): void {
    if (tool === "draw" && this.brush === "eraser") {
      this.brush = this.store.getSettings().brushes.activeBrush ?? "pen";
    }
    this.tool = tool;
    if (tool === "draw") this.activePageView?.clearSelection();
    this.refreshToolState();
    this.refreshInspector();
  }

  private setBrush(brush: BrushKind | "eraser"): void {
    this.brush = brush;
    this.tool = "draw";
    if (brush !== "eraser") {
      this.store.updateBrushSettings({ activeBrush: brush });
    }
    this.activePageView?.clearSelection();
    this.refreshToolState();
    this.refreshInspector();
  }

  private patchBrush(patch: Partial<ToolState["brushSettings"]>): void {
    if (this.brush === "eraser") return;
    const brushes = this.store.getSettings().brushes;
    const key = this.brush;
    const updated = { ...brushes[key], ...patch };
    this.store.updateBrushSettings({
      ...brushes,
      [key]: updated,
      ...(patch.color ? { activeColor: patch.color } : {}),
    });
    if (patch.color) this.shapeStyle.stroke = patch.color;
    this.toolbar.update();
  }

  private refreshToolState(): void {
    this.toolbar?.update();
    this.updateCursors();
  }

  afterToolUse(): void {
    if (this.tool === "text" || this.tool === "shape" || this.tool === "decorate") {
      this.tool = "select";
      this.refreshToolState();
    }
  }

  private updateCursors(): void {
    const tool = this.tool;
    const brush = this.brush;
    for (const view of [this.pageViews.left, this.pageViews.right]) {
      if (!view) continue;
      view.root.dataset.tool = tool === "draw" && brush === "eraser" ? "eraser" : tool;
    }
  }

  // ---------------------------------------------------------------------
  // PageHost implementation
  // ---------------------------------------------------------------------

  isDarkTheme(): boolean {
    return this.store.getSettings().theme === "dark";
  }

  resolveColor(value: string): string {
    if (!value) return "#2b251c";
    if (value.startsWith("#") || value.startsWith("rgb") || value.startsWith("hsl")) return value;
    const variables: Record<string, string> = {
      ink: "--fb-ink",
      "ink-soft": "--fb-ink-soft",
      accent: "--fb-accent",
      highlight: "--fb-highlight",
      muted: "--fb-rule",
      paper: "--fb-paper-3",
    };
    if (variables[value]) {
      const resolved = getComputedStyle(this.rootEl).getPropertyValue(variables[value]).trim();
      if (resolved) return resolved;
    }
    const palette: Record<string, string> = {
      cream: "#ddd2b6",
      ocean: "#7d97a7",
      sage: "#9aa47f",
      rust: "#ad6c52",
      plum: "#8a6780",
      gold: "#bca061",
      charcoal: "#5f574c",
      rose: "#b88a84",
      graphite: "#3a3a38",
      crimson: "#92382f",
      forest: "#536444",
      navy: "#3c5164",
      amber: "#c1933f",
      white: "#f6f3ea",
      black: "#1f1d1a",
    };
    return palette[value] ?? "#2b251c";
  }

  resourcePath(path: string): string {
    return this.plugin.storage.resourcePath(path);
  }

  attachmentExists(path: string): boolean {
    if (!path) return false;
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  onSelectionChange(page: PageView | null): void {
    if (page && page !== this.activePageView && page.page) {
      this.setActivePageView(page, false);
    }
    this.refreshInspector();
  }

  onPageEdited(page: PageView): void {
    void page;
    this.refreshInspector();
    this.toolbar?.update();
  }

  onPageContentChanged(pageId: string): void {
    let changed = false;
    for (const view of [this.pageViews.left, this.pageViews.right]) {
      if (view && view.pageId === pageId && !view.destroyed) {
        view.externalPageChanged();
        changed = true;
      }
    }
    if (changed) this.refreshInspector();
  }

  openElementMenu(event: MouseEvent, page: PageView, element: PageElement): void {
    const menu = new Menu();
    const selected = page.getSelectedElements();
    if (element.type === "text") {
      menu.addItem((item) =>
        item.setTitle("Edit text").setIcon("pencil").onClick(() => {
          page.editSelectedText();
          this.refreshInspector();
        }),
      );
      if (element.link) {
        menu.addItem((item) =>
          item.setTitle("Open link").setIcon("external-link").onClick(() => {
            this.openLink(element.link);
          }),
        );
      }
      menu.addSeparator();
    }
    if (element.type === "image") {
      menu.addItem((item) =>
        item.setTitle("Crop photo\u2026").setIcon("crop").onClick(() => {
          this.openCrop(page, element);
        }),
      );
      menu.addItem((item) =>
        item.setTitle("Tape this photo").setIcon("rectangle-horizontal").onClick(() => {
          page.addTapeToImage(element);
          this.refreshInspector();
        }),
      );
      menu.addItem((item) =>
        item.setTitle(element.border ? "Remove border" : "Add border").setIcon("square").onClick(() => {
          page.updateSelectedImage({ border: !element.border });
          this.refreshInspector();
        }),
      );
      menu.addItem((item) =>
        item.setTitle(element.shadow ? "Remove shadow" : "Add shadow").setIcon("sun").onClick(() => {
          page.updateSelectedImage({ shadow: !element.shadow });
          this.refreshInspector();
        }),
      );
      menu.addSeparator();
    }
    menu.addItem((item) =>
      item.setTitle("Copy").setIcon("copy").onClick(() => this.copySelection()),
    );
    menu.addItem((item) =>
      item.setTitle("Cut").setIcon("scissors").onClick(() => {
        this.copySelection();
        page.deleteSelection();
        this.refreshInspector();
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Duplicate").setIcon("copy-plus").onClick(() => {
        page.duplicateSelection();
        this.refreshInspector();
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Delete").setIcon("trash").onClick(() => {
        page.deleteSelection();
        this.refreshInspector();
      }),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Bring to front").setIcon("bring-to-front").onClick(() => page.reorderSelection("front")),
    );
    menu.addItem((item) =>
      item.setTitle("Bring forward").setIcon("arrow-up").onClick(() => page.reorderSelection("forward")),
    );
    menu.addItem((item) =>
      item.setTitle("Send backward").setIcon("arrow-down").onClick(() => page.reorderSelection("backward")),
    );
    menu.addItem((item) =>
      item.setTitle("Send to back").setIcon("send-to-back").onClick(() => page.reorderSelection("back")),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Move to layer").setIcon("layers").onClick(() => {
        const layerMenu = new Menu();
        for (const layer of page.page?.layers ?? []) {
          layerMenu.addItem((sub) =>
            sub
              .setTitle(layer.name)
              .setChecked(selected.every((el) => el.layer === layer.id))
              .onClick(() => {
                page.moveSelectionToLayer(layer.id);
                this.refreshInspector();
              }),
          );
        }
        layerMenu.showAtMouseEvent(event);
      }),
    );
    if (selected.length > 1) {
      menu.addItem((item) =>
        item.setTitle("Group").setIcon("boxes").onClick(() => {
          page.groupSelection();
          this.refreshInspector();
        }),
      );
    }
    if (selected.some((el) => el.groupId)) {
      menu.addItem((item) =>
        item.setTitle("Ungroup").setIcon("ungroup").onClick(() => {
          page.ungroupSelection();
          this.refreshInspector();
        }),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(element.pinned ? "Unpin" : "Pin")
        .setIcon("pin")
        .onClick(() => {
          page.togglePinSelection();
          this.refreshInspector();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Lock")
        .setIcon("lock")
        .onClick(() => {
          page.toggleLockSelection();
          this.refreshInspector();
        }),
    );
    menu.showAtMouseEvent(event);
  }

  openPageMenu(event: MouseEvent, page: PageView): void {
    const menu = new Menu();
    const spread = this.store.getLayout()[this.currentSpread];
    const tabId = spread?.tabId ?? this.activeTabId ?? this.store.getTabs()[0]?.id ?? "";
    menu.addItem((item) =>
      item.setTitle("New page").setIcon("file-plus").onClick(() => void this.addPage(tabId)),
    );
    menu.addItem((item) =>
      item.setTitle("New text block").setIcon("type").onClick(() => {
        this.pendingActiveSide = page.side;
        this.setTool("text");
        this.toast("Click the page to write.");
      }),
    );
    if (this.clipboard.length) {
      menu.addItem((item) =>
        item.setTitle("Paste here").setIcon("clipboard-paste").onClick(() => {
          page.pasteElements(this.clipboard);
        }),
      );
    }
    if (page.pageId) {
      const meta = this.store.getPageMeta(page.pageId);
      if (meta) {
        menu.addSeparator();
        menu.addItem((item) =>
          item.setTitle("Rename page").setIcon("pencil").onClick(() => this.promptRenamePage(meta)),
        );
        menu.addItem((item) =>
          item.setTitle("Duplicate page").setIcon("copy-plus").onClick(() => {
            void this.store.duplicatePage(meta.id).then((copy) => {
              if (copy) this.navigateToPage(copy.id);
            });
          }),
        );
        menu.addItem((item) =>
          item.setTitle("Page background").setIcon("layout-template").onClick(() => {
            const bgMenu = new Menu();
            const options: [PageBackground, string][] = [
              ["plain", "Plain paper"],
              ["ruled", "Ruled lines"],
              ["grid", "Square grid"],
              ["dots", "Dot grid"],
            ];
            for (const [value, label] of options) {
              bgMenu.addItem((sub) =>
                sub
                  .setTitle(label)
                  .setChecked(meta.background === value)
                  .onClick(() => this.store.setPageBackground(meta.id, value)),
              );
            }
            bgMenu.showAtMouseEvent(event);
          }),
        );
        menu.addItem((item) =>
          item.setTitle("Move to tab").setIcon("folder-input").onClick(() => {
            const moveMenu = new Menu();
            const tabs = this.store.getTabs().filter((tab) => tab.id !== meta.tabId);
            if (!tabs.length) {
              this.toast("There is only one tab.");
              return;
            }
            for (const tab of tabs) {
              moveMenu.addItem((sub) =>
                sub.setTitle(tab.name).onClick(() => {
                  this.store.movePage(meta.id, tab.id, tab.pageIds.length);
                  this.navigateToPage(meta.id);
                }),
              );
            }
            moveMenu.showAtMouseEvent(event);
          }),
        );
        menu.addItem((item) =>
          item.setTitle("Export page").setIcon("download").onClick(() => void this.exportPageFromMenu(meta)),
        );
        menu.addSeparator();
        menu.addItem((item) =>
          item.setTitle("Delete page").setIcon("trash").onClick(() => this.confirmDeletePage(meta)),
        );
      }
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Notebook map\u2026").setIcon("library").onClick(() => this.openPageManager()),
    );
    menu.addItem((item) =>
      item.setTitle("Paste image from clipboard").setIcon("clipboard-paste").onClick(() => {
        void this.pasteFromSystemClipboard(page);
      }),
    );
    menu.showAtMouseEvent(event);
  }

  openCrop(page: PageView | null, image: ImageElement): void {
    if (!page) return;
    const meta = this.store.getPageMeta(page.pageId ?? "");
    void meta;
    new CropModal(this.app, {
      imageUrl: this.resourcePath(image.attachment),
      naturalW: image.naturalW,
      naturalH: image.naturalH,
      crop: image.crop,
      onApply: (crop) => {
        page.applyCropToImage(image.id, crop);
        this.refreshInspector();
      },
    }).open();
  }

  openLink(link: string): void {
    void this.app.workspace.openLinkText(link, "", true);
  }

  notify(message: string): void {
    new Notice(message);
  }

  // ---------------------------------------------------------------------
  // Selection, clipboard, history
  // ---------------------------------------------------------------------

  private activePageOrNull(): PageView | null {
    if (this.activePageView?.page) return this.activePageView;
    const left = this.pageViews.left;
    if (left?.page) return left;
    const right = this.pageViews.right;
    if (right?.page) return right;
    return null;
  }

  private copySelection(): void {
    const page = this.activePageOrNull();
    if (!page) return;
    const elements = page.serializeSelection();
    if (!elements.length) return;
    this.clipboard = elements;
    this.toast(`Copied ${elements.length} object${elements.length === 1 ? "" : "s"}.`);
  }

  private pasteClipboard(): void {
    const page = this.activePageOrNull();
    if (!page || !this.clipboard.length) return;
    page.pasteElements(this.clipboard);
    this.refreshInspector();
  }

  private async undo(): Promise<void> {
    this.activePageView?.commitPending();
    const changed = await this.history.undo();
    if (changed) {
      this.refreshInspector();
      this.toolbar.update();
    }
  }

  private async redo(): Promise<void> {
    this.activePageView?.commitPending();
    const changed = await this.history.redo();
    if (changed) {
      this.refreshInspector();
      this.toolbar.update();
    }
  }

  private refreshInspector(): void {
    if (this.inspector?.isPickingColor()) return;
    const view = this.activePageView;
    if (!view || !view.page || view.page.kind === "contents" || this.tool === "draw") {
      this.inspector?.clear();
      return;
    }
    this.inspector?.render(view.getSelectionInfo(), view);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".fb-topbar, .fb-rail, .fb-brush-dock, .fb-inspector, .fb-footer, .modal-container")) {
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const lower = physicalKey(event);
    if (mod && lower === "z") {
      event.preventDefault();
      void (event.shiftKey ? this.redo() : this.undo());
      return;
    }
    if (mod && lower === "y") {
      event.preventDefault();
      void this.redo();
      return;
    }
    if (mod && lower === "c") {
      event.preventDefault();
      this.copySelection();
      return;
    }
    if (mod && lower === "x") {
      event.preventDefault();
      this.copySelection();
      this.activePageView?.deleteSelection();
      this.refreshInspector();
      return;
    }
    if (mod && lower === "v") {
      if (this.clipboard.length) {
        event.preventDefault();
        this.pasteClipboard();
      }
      return;
    }
    if (mod && lower === "a") {
      event.preventDefault();
      this.activePageView?.selectAll();
      this.refreshInspector();
      return;
    }
    if (mod && lower === "d") {
      event.preventDefault();
      this.activePageView?.duplicateSelection();
      this.refreshInspector();
      return;
    }
    if (mod && lower === "g") {
      event.preventDefault();
      if (event.shiftKey) this.activePageView?.ungroupSelection();
      else this.activePageView?.groupSelection();
      this.refreshInspector();
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      if (this.activePageView?.hasSelection()) {
        event.preventDefault();
        this.activePageView.deleteSelection();
        this.refreshInspector();
      }
      return;
    }
    if (key === "PageDown") {
      event.preventDefault();
      this.turnPage(1);
      return;
    }
    if (key === "PageUp") {
      event.preventDefault();
      this.turnPage(-1);
      return;
    }
    if (key === "Escape") {
      if (this.activePageView?.isEditing()) return;
      if (this.tool !== "select") {
        this.setTool("select");
      } else {
        this.activePageView?.clearSelection();
        this.refreshInspector();
      }
      return;
    }
    if (!mod && !event.altKey) {
      const tools: Record<string, () => void> = {
        v: () => this.setTool("select"),
        t: () => this.setTool("text"),
        p: () => this.setTool("draw"),
        e: () => this.setBrush("eraser"),
        i: () => this.pickLocalImages(),
      };
      const action = tools[lower];
      if (action) {
        event.preventDefault();
        action();
      }
      if (key.startsWith("Arrow")) {
        const page = this.activePageView;
        if (page?.hasSelection()) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
          const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
          page.nudgeSelection(dx, dy);
          this.refreshInspector();
        }
      }
    }
  };

  // ---------------------------------------------------------------------
  // Menus, modals and settings
  // ---------------------------------------------------------------------

  private promptRenamePage(meta: PageMeta): void {
    new PromptModal(this.app, {
      title: "Rename page",
      value: meta.title,
      onSubmit: (value) => this.store.renamePage(meta.id, value),
    }).open();
  }

  private confirmDeletePage(meta: PageMeta): void {
    new ConfirmModal(this.app, {
      title: "Move page to trash?",
      message: `"${meta.title}" will be moved to the notebook trash. You can restore it later.`,
      cta: "Move to trash",
      destructive: true,
      onConfirm: () => {
        void this.store.deletePage(meta.id).then(() => {
          this.history.clear();
          this.toast("Page moved to trash.");
        });
      },
    }).open();
  }

  private openTabMenu(event: MouseEvent, tab: TabData): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Rename tab").setIcon("pencil").onClick(() => {
        new PromptModal(this.app, {
          title: "Rename tab",
          value: tab.name,
          onSubmit: (value) => this.store.renameTab(tab.id, value),
        }).open();
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Add page").setIcon("file-plus").onClick(() => void this.addPage(tab.id)),
    );
    menu.addItem((item) =>
      item.setTitle("Tab colour").setIcon("palette").onClick(() => {
        const colorMenu = new Menu();
        for (const color of TAB_COLOR_OPTIONS) {
          colorMenu.addItem((sub) =>
            sub
              .setTitle(color.charAt(0).toUpperCase() + color.slice(1))
              .setChecked(tab.color === color)
              .onClick(() => {
                this.store.setTabColor(tab.id, color as TabColor);
                this.updateChrome();
              }),
          );
        }
        colorMenu.showAtMouseEvent(event);
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Tab icon").setIcon("shapes").onClick(() => {
        const iconMenu = new Menu();
        for (const icon of TAB_ICONS) {
          iconMenu.addItem((sub) =>
            sub.setTitle(icon).setIcon(icon).onClick(() => {
              this.store.setTabIcon(tab.id, icon);
              this.updateChrome();
            }),
          );
        }
        iconMenu.showAtMouseEvent(event);
      }),
    );
    menu.addSeparator();
    const index = this.store.getTabs().findIndex((entry) => entry.id === tab.id);
    menu.addItem((item) =>
      item.setTitle("Move tab left").setIcon("arrow-left").setDisabled(index <= 0).onClick(() => {
        this.store.reorderTab(tab.id, index - 1);
      }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move tab right")
        .setIcon("arrow-right")
        .setDisabled(index < 0 || index >= this.store.getTabs().length - 1)
        .onClick(() => {
          this.store.reorderTab(tab.id, index + 1);
        }),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Delete tab").setIcon("trash").onClick(() => {
        new ConfirmModal(this.app, {
          title: "Delete this tab?",
          message: `"${tab.name}" and its ${tab.pageIds.length} page(s) will be moved to the notebook trash.`,
          cta: "Delete tab",
          destructive: true,
          onConfirm: () => {
            void this.store.deleteTab(tab.id).then(() => {
              this.history.clear();
              this.toast("Tab moved to trash.");
            });
          },
        }).open();
      }),
    );
    menu.showAtMouseEvent(event);
  }

  private openPageManager(): void {
    new PageManagerModal(this.app, {
      store: this.store,
      getCurrentPageId: () => this.activePageView?.pageId ?? null,
      navigateToPage: (pageId) => this.navigateToPage(pageId),
      onDestructiveDelete: () => this.history.clear(),
    }).open();
  }

  private openLayers(anchor: HTMLElement): void {
    const view = this.activePageOrNull();
    if (!view) {
      this.toast("Open a page to manage layers.");
      return;
    }
    openLayersPanel(anchor, view);
  }

  private openExportMenu(anchor: HTMLElement): void {
    const view = this.activePageOrNull();
    if (!view) {
      this.toast("Open a page first.");
      return;
    }
    openPopover(anchor, (host, close) => {
      popoverHeading(host, "Export");
      popoverItem(host, "file-text", "Markdown note", () => {
        close();
        void this.exportMarkdownPage();
      });
      popoverItem(host, "image", "Page as PNG", () => {
        close();
        void this.exportPageImage();
      });
      const hint = document.createElement("div");
      hint.className = "fb-popover__note";
      hint.textContent = "The original interactive page is never changed by exporting.";
      host.appendChild(hint);
    });
  }

  private async exportPageFromMenu(meta: PageMeta): Promise<void> {
    const page = await this.store.loadPage(meta.id);
    if (!page) return;
    try {
      const path = await exportPageToMarkdown({
        app: this.app,
        storage: this.plugin.storage,
        journal: this.store,
        page,
        meta,
      });
      this.toast(`Exported ${path}`);
    } catch (error) {
      console.error(error);
      new Notice("Fieldbook: export failed.");
    }
  }

  private async exportMarkdownPage(): Promise<void> {
    const view = this.activePageOrNull();
    if (!view?.page) return;
    view.commitPending();
    const meta = this.store.getPageMeta(view.page.id);
    if (!meta) return;
    try {
      const path = await exportPageToMarkdown({
        app: this.app,
        storage: this.plugin.storage,
        journal: this.store,
        page: view.page,
        meta,
      });
      this.audio.play("ui");
      this.toast(`Markdown saved to ${path}`);
    } catch (error) {
      console.error(error);
      new Notice("Fieldbook: could not export Markdown.");
    }
  }

  private async exportPageImage(): Promise<void> {
    const view = this.activePageOrNull();
    if (!view?.page) return;
    view.commitPending();
    const meta = this.store.getPageMeta(view.page.id);
    if (!meta) return;
    try {
      const canvas = await renderPageToCanvas({
        app: this.app,
        page: view.page,
        meta,
        journal: this.store,
        scale: 2,
      });
      const path = await saveCanvasPng(
        this.plugin.storage,
        canvas,
        safeExportName(meta.title || "Fieldbook page", "png"),
      );
      this.audio.play("ui");
      this.toast(`Image saved to ${path}`);
    } catch (error) {
      console.error(error);
      new Notice("Fieldbook: could not export the page image.");
    }
  }

  private pickMarkdownFile(): void {
    new FilePickerModal(this.app, "md", (file) => {
      void this.importMarkdownFile(file);
    }).open();
  }

  private async importMarkdownFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.cachedRead(file);
      const settings = this.store.getSettings();
      const imported = await importMarkdown(this.app, content, file.path, settings);
      const tabId =
        this.store.getLayout()[this.currentSpread]?.tabId ??
        this.activeTabId ??
        this.store.getTabs()[0]?.id;
      if (!tabId) {
        new Notice("Fieldbook: create a tab before importing.");
        return;
      }
      this.suppressStructureRender = true;
      const created: string[] = [];
      const baseName = file.basename;
      for (let index = 0; index < imported.pages.length; index++) {
        const title = index === 0 ? baseName : `${baseName} ${index + 1}`;
        const page = await this.store.createPage(tabId, { title });
        if (!page) continue;
        page.elements = imported.pages[index];
        this.store.markPageDirty(page.id);
        created.push(page.id);
      }
      this.suppressStructureRender = false;
      if (this.structureTimer !== null) {
        window.clearTimeout(this.structureTimer);
        this.structureTimer = null;
      }
      await this.store.flush();
      if (created.length) {
        this.navigateToPage(created[0]);
        this.toast(
          `Imported ${created.length} page${created.length === 1 ? "" : "s"} from ${file.basename}.`,
        );
      }
    } catch (error) {
      this.suppressStructureRender = false;
      console.error(error);
      new Notice("Fieldbook: could not import that Markdown note.");
    }
  }

  openBookSettings(): void {
    new BookSettingsModal(this.app, {
      store: this.store,
      pluginSettings: this.plugin.settings,
      updateJournal: (patch) => this.store.updateSettings(patch),
      updateSound: (patch) => this.updateSoundSettings(patch),
      updateStorage: async (patch) => {
        await this.plugin.updateStorageFolders(patch);
        const storage = this.store.storage;
        if (patch.attachmentsFolder !== undefined) {
          this.toast(`Photos and sounds now save to "${storage.attachmentsDir}".`);
        } else if (patch.exportsFolder !== undefined) {
          this.toast(`Exports now save to "${storage.exportsDir}".`);
        }
      },
      changeDataFolder: (folder) => this.plugin.changeDataFolder(folder),
      storageDirs: () => {
        const storage = this.store.storage;
        return {
          notebook: storage.root,
          attachments: storage.attachmentsDir,
          exports: storage.exportsDir,
        };
      },
      playSound: (category: SoundCategory) => this.audio.play(category),
      resizePages: (width, height) => void this.resizeAllPages(width, height),
      openFullSettings: () => this.plugin.openPluginSettings(),
      openPages: () => this.openPageManager(),
      importMarkdown: () => this.pickMarkdownFile(),
      exportPage: () => void this.exportMarkdownPage(),
    }).open();
  }

  private updateSoundSettings(patch: Partial<PluginSettings>): void {
    Object.assign(this.plugin.settings, patch);
    if (patch.soundEnabled !== undefined) {
      this.plugin.audio.setEnabled(patch.soundEnabled);
      if (patch.soundEnabled) this.plugin.audio.unlock();
    }
    this.plugin.audio.updateSettings(this.plugin.settings);
    void this.plugin.saveSettings();
    this.updateSoundButton();
  }

  private toggleSound(): void {
    this.updateSoundSettings({ soundEnabled: !this.plugin.settings.soundEnabled });
    this.audio.play("ui");
  }

  private updateSoundButton(): void {
    if (!this.soundButton) return;
    this.soundButton.empty();
    const icon = this.soundButton.createSpan();
    setIcon(icon, this.plugin.settings.soundEnabled ? "volume-2" : "volume-x");
    this.soundButton.toggleClass("is-active", this.plugin.settings.soundEnabled);
    this.soundButton.title = this.plugin.settings.soundEnabled ? "Sound on" : "Sound off";
  }

  private onFocusEscape = (event: KeyboardEvent): void => {
    if (!this.focusMode || event.key !== "Escape" || event.isComposing) return;
    if (document.querySelector(".modal-container, .menu, .suggestion-container, .fb-popover")) return;
    if (this.activePageView?.isEditing()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.setFocusMode(false);
  };

  private toggleFocusMode(): void {
    this.setFocusMode(!this.focusMode);
  }

  private setFocusMode(enabled: boolean, options: { silent?: boolean } = {}): void {
    this.focusMode = enabled;
    this.rootEl.toggleClass("is-focus", enabled);
    document.body.toggleClass("fieldbook-focus-mode", enabled);
    this.focusButton?.toggleClass("is-active", enabled);
    this.rootEl
      .querySelector('.fb-rail__button[data-tool="focus"]')
      ?.classList.toggle("is-active", enabled);
    if (!options.silent) this.audio.play("ui");
    window.setTimeout(() => this.scheduleMeasure(), 120);
    if (enabled && !options.silent) this.toast("Focus mode. Press Esc or the focus button to leave.");
  }

  private async resizeAllPages(width: number, height: number): Promise<void> {
    const settings = this.store.getSettings();
    const oldW = settings.pageWidth;
    const oldH = settings.pageHeight;
    if (oldW === width && oldH === height) return;
    const rx = width / oldW;
    const ry = height / oldH;
    const factor = Math.sqrt(rx * ry);
    this.suppressStructureRender = true;
    try {
      this.store.updateSettings({ pageWidth: width, pageHeight: height });
      for (const id of Object.keys(this.store.journal.pages)) {
        const page = await this.store.loadPage(id);
        if (!page) continue;
        for (const el of page.elements) {
          el.x *= rx;
          el.y *= ry;
          el.w *= rx;
          el.h *= ry;
          if (el.type === "text") el.fontSize *= factor;
          else if (el.type === "shape") el.strokeWidth *= factor;
          else if (el.type === "drawing") {
            el.size *= factor;
            el.baseW *= rx;
            el.baseH *= ry;
          } else if (el.type === "image") el.radius *= factor;
        }
        this.store.markPageDirty(id);
      }
      await this.store.flush();
    } finally {
      this.suppressStructureRender = false;
    }
    this.measureBook();
    await this.renderSpreadNow(this.currentSpread);
    this.toast(`Pages resized to ${width} \u00d7 ${height}.`);
  }

  // ---------------------------------------------------------------------
  // Images, paste and drop
  // ---------------------------------------------------------------------

  private pickLocalImages(): void {
    if (!this.fileInput) {
      this.fileInput = document.createElement("input");
      this.fileInput.type = "file";
      this.fileInput.accept = "image/*";
      this.fileInput.multiple = true;
      this.fileInput.style.display = "none";
      this.rootEl.appendChild(this.fileInput);
      this.fileInput.addEventListener("change", () => {
        const files = Array.from(this.fileInput?.files ?? []);
        if (files.length) void this.insertImageFiles(files);
        if (this.fileInput) this.fileInput.value = "";
      });
    }
    this.fileInput.click();
  }

  private pickVaultImage(): void {
    new ImagePickerModal(this.app, (file) => {
      const page = this.activePageOrNull();
      if (!page) {
        this.toast("Open a page first.");
        return;
      }
      const img = new Image();
      img.onload = () => {
        page.insertImage(file.path, img.naturalWidth, img.naturalHeight);
      };
      img.onerror = () => page.insertImage(file.path, 0, 0);
      img.src = this.app.vault.adapter.getResourcePath(file.path);
    }).open();
  }

  private async insertImageFiles(files: File[], page?: PageView | null, at?: { x: number; y: number }): Promise<void> {
    const target = page?.page ? page : this.activePageOrNull();
    if (!target) {
      this.toast("Open a page before adding a photo.");
      return;
    }
    let offset = 0;
    for (const file of files) {
      const saved = await saveImageFile(this.app, this.plugin.storage, file, file.name.replace(/\.[^.]+$/, ""));
      if (!saved) continue;
      const point = at ? { x: at.x + offset, y: at.y + offset } : undefined;
      target.insertImage(saved.path, saved.naturalW, saved.naturalH, point);
      offset += 28;
    }
    this.refreshInspector();
  }

  private async pasteFromSystemClipboard(page?: PageView | null): Promise<void> {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            files.push(new File([blob], `pasted.${type.split("/")[1] ?? "png"}`, { type }));
          }
        }
      }
      if (files.length) await this.insertImageFiles(files, page);
      else this.toast("No image found in the clipboard.");
    } catch {
      this.toast("Clipboard access was denied. Use Ctrl+V on a page instead.");
    }
  }

  private onPaste = (event: ClipboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    if (!event.clipboardData) return;
    const files = filesFromClipboard(event.clipboardData);
    if (files.length) {
      event.preventDefault();
      void this.insertImageFiles(files);
      return;
    }
    const text = event.clipboardData.getData("text/plain").trim();
    if (!text) return;
    const page = this.activePageOrNull();
    if (!page) return;
    event.preventDefault();
    const wiki = parseWikiLink(text);
    if (wiki) {
      const file = this.app.metadataCache.getFirstLinkpathDest(wiki.target, "");
      if (file && /^(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(file.extension)) {
        const img = new Image();
        img.onload = () => page.insertImage(file.path, img.naturalWidth, img.naturalHeight);
        img.onerror = () => page.insertImage(file.path, 0, 0);
        img.src = this.app.vault.adapter.getResourcePath(file.path);
        return;
      }
    }
    page.insertText(text);
    this.refreshInspector();
  };

  private onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    this.rootEl.addClass("is-drop-target");
  };

  private onDragLeave = (event: DragEvent): void => {
    if (event.relatedTarget && this.rootEl.contains(event.relatedTarget as Node)) return;
    this.rootEl.removeClass("is-drop-target");
  };

  private onDrop = (event: DragEvent): void => {
    this.rootEl.removeClass("is-drop-target");
    if (!event.dataTransfer) return;
    event.preventDefault();
    const target = this.pageViewAt(event.clientX, event.clientY);
    const point = target ? target.root.getBoundingClientRect() : null;
    const at = target && point
      ? {
          x: (event.clientX - point.left) / target.scale,
          y: (event.clientY - point.top) / target.scale,
        }
      : undefined;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      void this.insertImageFiles(files, target, at);
      return;
    }
    const text = event.dataTransfer.getData("text/plain");
    if (text) {
      const wiki = parseWikiLink(text);
      const path = wiki?.target ?? text.trim();
      const file = this.app.metadataCache.getFirstLinkpathDest(path, "");
      if (file && /^(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(file.extension) && target?.page) {
        const img = new Image();
        img.onload = () => target.insertImage(file.path, img.naturalWidth, img.naturalHeight, at);
        img.onerror = () => target.insertImage(file.path, 0, 0, at);
        img.src = this.app.vault.adapter.getResourcePath(file.path);
      }
    }
  };

  private pageViewAt(x: number, y: number): PageView | null {
    for (const view of [this.pageViews.left, this.pageViews.right]) {
      if (!view) continue;
      const rect = view.root.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return view;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  private toast(message: string): void {
    if (!this.rootEl) return;
    if (!this.toastEl) {
      this.toastEl = this.rootEl.createDiv({ cls: "fb-toast" });
    }
    this.toastEl.setText(message);
    this.toastEl.addClass("is-visible");
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl?.removeClass("is-visible");
      this.toastTimer = null;
    }, 2600);
  }

  async refreshActivePage(): Promise<void> {
    await this.renderSpreadNow(this.currentSpread);
  }

  getActivePageView(): PageView | null {
    return this.activePageView;
  }

  async createPageFromCommand(): Promise<void> {
    await this.addPage();
  }

  async exportFromCommand(): Promise<void> {
    await this.exportMarkdownPage();
  }

  toggleFocusFromCommand(): void {
    this.toggleFocusMode();
  }
}

function filesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = Array.from(data.files ?? []);
  if (files.length) return files;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

