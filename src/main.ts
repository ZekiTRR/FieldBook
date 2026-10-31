import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_PLUGIN_SETTINGS,
  VIEW_TYPE,
  type PluginSettings,
} from "./types";
import { StorageManager } from "./storage/StorageManager";
import { JournalManager } from "./core/JournalManager";
import { AudioManager } from "./audio/AudioManager";
import { FieldbookView } from "./views/FieldbookView";
import { FieldbookSettingsTab } from "./ui/SettingsTab";
import { closeAllPopovers } from "./ui/Popover";

interface StoredData {
  settings?: Partial<PluginSettings>;
}

export default class FieldbookPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_PLUGIN_SETTINGS };
  storage!: StorageManager;
  store!: JournalManager;
  audio!: AudioManager;

  async onload(): Promise<void> {
    await this.loadPluginSettings();
    this.storage = new StorageManager(
      this.app,
      this.settings.dataFolder,
      this.settings.attachmentsFolder,
      this.settings.exportsFolder,
    );
    this.store = new JournalManager(this.app, this.storage, "Fieldbook");
    try {
      await this.store.init();
    } catch (error) {
      console.error("Fieldbook: notebook could not be initialised", error);
      new Notice("Fieldbook: the notebook folder could not be initialised. Check the plugin settings.");
    }
    this.audio = new AudioManager(this.app, this.settings, this.manifest.dir ?? "");

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new FieldbookView(leaf, this));

    this.addRibbonIcon("book-open", "Open Fieldbook", () => {
      void this.openNotebook();
    });

    this.addCommand({
      id: "open-notebook",
      name: "Open notebook",
      callback: () => {
        void this.openNotebook();
      },
    });

    this.addCommand({
      id: "new-page",
      name: "Add page",
      callback: async () => {
        const view = await this.openNotebook();
        await view?.createPageFromCommand();
      },
    });

    this.addCommand({
      id: "toggle-focus-mode",
      name: "Toggle focus mode",
      checkCallback: (checking) => {
        const view = this.getActiveView();
        if (!view) return false;
        if (!checking) view.toggleFocusFromCommand();
        return true;
      },
    });

    this.addCommand({
      id: "export-page-markdown",
      name: "Export current page to Markdown",
      checkCallback: (checking) => {
        const view = this.getActiveView();
        if (!view) return false;
        if (!checking) void view.exportFromCommand();
        return true;
      },
    });

    this.addCommand({
      id: "notebook-settings",
      name: "Open notebook settings",
      callback: async () => {
        const view = await this.openNotebook();
        view?.openBookSettings();
      },
    });

    this.addCommand({
      id: "save-notebook",
      name: "Save notebook now",
      callback: () => {
        void this.store.flush();
        new Notice("Fieldbook saved.");
      },
    });

    this.addSettingTab(new FieldbookSettingsTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) void this.handleFileRenamed(file, oldPath);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("quit", (tasks) => {
        tasks.add(async () => {
          await this.store.flush();
        });
      }),
    );
  }

  onunload(): void {
    closeAllPopovers();
    this.audio?.dispose();
    void this.store?.flush();
  }

  private async loadPluginSettings(): Promise<void> {
    const raw = (await this.loadData()) as StoredData | null;
    const stored = raw?.settings;
    this.settings = {
      ...DEFAULT_PLUGIN_SETTINGS,
      ...(stored ?? {}),
      soundVolumes: {
        ...DEFAULT_PLUGIN_SETTINGS.soundVolumes,
        ...(stored?.soundVolumes ?? {}),
      },
      customSounds: {
        ...DEFAULT_PLUGIN_SETTINGS.customSounds,
        ...(stored?.customSounds ?? {}),
      },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings });
    this.audio?.updateSettings(this.settings);
  }

  async openNotebook(): Promise<FieldbookView | null> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    let leaf: WorkspaceLeaf;
    if (existing.length) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getLeaf(true);
    }
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof FieldbookView ? leaf.view : null;
  }

  openPluginSettings(): void {
    const internal = this.app as unknown as {
      setting?: { open: () => void; openTabById: (id: string) => void };
    };
    if (internal.setting) {
      internal.setting.open();
      internal.setting.openTabById(this.manifest.id);
    } else {
      new Notice("Fieldbook: open Settings \u2192 Community plugins \u2192 Fieldbook.");
    }
  }

  async changeDataFolder(folder: string): Promise<void> {
    const clean = folder.trim() || "Fieldbook";
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) leaf.detach();
    this.settings.dataFolder = clean;
    await this.saveSettings();
    this.storage.setRoot(clean);
    this.store = new JournalManager(this.app, this.storage, "Fieldbook");
    await this.store.init();
    await this.openNotebook();
  }

  /** Applies new attachment/export locations. Existing files stay where they are. */
  async updateStorageFolders(
    patch: Partial<Pick<PluginSettings, "attachmentsFolder" | "exportsFolder">>,
  ): Promise<void> {
    Object.assign(this.settings, patch);
    await this.saveSettings();
    this.storage.setFolders(this.settings.attachmentsFolder, this.settings.exportsFolder);
    await this.storage.ensureFolders();
  }

  private getActiveView(): FieldbookView | null {
    const active = this.app.workspace.getActiveViewOfType(FieldbookView);
    return active ?? null;
  }

  private async handleFileRenamed(file: TFile, oldPath: string): Promise<void> {
    if (!/^(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(file.extension)) return;
    const touchedCached = await this.store.attachmentRenamed(oldPath, file.path);
    let touchedAnywhere = touchedCached;
    for (const id of Object.keys(this.store.journal.pages)) {
      if (this.store.getCachedPage(id)) continue;
      const page = await this.store.loadPage(id);
      if (!page) continue;
      let touched = false;
      for (const el of page.elements) {
        if (el.type === "image" && el.attachment === oldPath) {
          el.attachment = file.path;
          touched = true;
        }
      }
      if (touched) {
        this.store.markPageDirty(id);
        touchedAnywhere = true;
      }
    }
    if (touchedAnywhere) this.store.emit({ type: "page" });
  }
}
