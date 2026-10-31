import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import type { SoundCategory } from "../types";
import type { AudioManager } from "../audio/AudioManager";
import type { JournalManager } from "../core/JournalManager";
import type { FieldbookPluginLike } from "../views/FieldbookView";
import { AudioPickerModal } from "./BasicModals";

export interface SettingsPlugin extends FieldbookPluginLike {
  changeDataFolder: (folder: string) => Promise<void>;
  openNotebook: () => Promise<unknown>;
  audio: AudioManager;
}

const SOUND_LABELS: { id: SoundCategory; label: string }[] = [
  { id: "page", label: "Page turns" },
  { id: "tabs", label: "Tabs" },
  { id: "writing", label: "Pen & pencil" },
  { id: "objects", label: "Photos & tape" },
  { id: "ui", label: "Interface" },
];

export class FieldbookSettingsTab extends PluginSettingTab {
  private readonly plugin: SettingsPlugin;
  private folderDraft = "";

  constructor(app: App, plugin: SettingsPlugin) {
    super(app, plugin as never);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("fieldbook-settings-tab");
    this.folderDraft = this.plugin.settings.dataFolder;

    containerEl.createEl("h2", { text: "Fieldbook" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "A physical notebook inside your vault. Pages are stored as JSON; photos live in a separate attachments folder.",
    });

    new Setting(containerEl)
      .setName("Open notebook")
      .setDesc("Open Fieldbook in the main workspace.")
      .addButton((button) =>
        button.setButtonText("Open").setCta().onClick(() => {
          void this.plugin.openNotebook();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Notebook settings").onClick(() => {
          void this.plugin.openNotebook().then(() => {
            const leaves = this.app.workspace.getLeavesOfType("fieldbook-view");
            const view = leaves[0]?.view as unknown as { openBookSettings?: () => void } | undefined;
            view?.openBookSettings?.();
          });
        }),
      );

    containerEl.createEl("h3", { text: "Storage" });
    new Setting(containerEl)
      .setName("Notebook folder")
      .setDesc("Vault-relative folder for journal.json, pages, attachments and exports. Changing it reopens the notebook.")
      .addText((text) =>
        text.setValue(this.folderDraft).onChange((value) => {
          this.folderDraft = value;
        }),
      )
      .addButton((button) =>
        button
          .setButtonText("Apply & reopen")
          .setWarning()
          .onClick(async () => {
            const next = this.folderDraft.trim() || "Fieldbook";
            if (next === this.plugin.settings.dataFolder) return;
            await this.plugin.changeDataFolder(next);
            new Notice(`Fieldbook now uses "${next}".`);
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Check attachments")
      .setDesc("Look for photos whose files are missing from the vault.")
      .addButton((button) =>
        button.setButtonText("Check").onClick(async () => {
          await this.validateAttachments();
        }),
      );

    containerEl.createEl("h3", { text: "Sound" });
    new Setting(containerEl)
      .setName("Enable sound")
      .setDesc("Paper sounds are optional and start switched off.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.soundEnabled).onChange((value) => {
          this.plugin.settings.soundEnabled = value;
          this.plugin.audio.setEnabled(value);
          if (value) this.plugin.audio.unlock();
          void this.save();
        }),
      );

    new Setting(containerEl)
      .setName("Master volume")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 1)
          .setValue(Math.round(this.plugin.settings.masterVolume * 100))
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.masterVolume = value / 100;
            this.plugin.audio.updateSettings(this.plugin.settings);
            void this.save();
          }),
      );

    new Setting(containerEl)
      .setName("Keyboard writing sound")
      .setDesc("Play a quiet pen scratch while typing text in the notebook. Requires sound to be on.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.typingSoundEnabled).onChange((value) => {
          this.plugin.settings.typingSoundEnabled = value;
          this.plugin.audio.updateSettings(this.plugin.settings);
          void this.save();
        }),
      );

    for (const category of SOUND_LABELS) {
      new Setting(containerEl).setName(category.label).addSlider((slider) =>
        slider
          .setLimits(0, 100, 1)
          .setValue(Math.round((this.plugin.settings.soundVolumes[category.id] ?? 0.5) * 100))
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.soundVolumes[category.id] = value / 100;
            this.plugin.audio.updateSettings(this.plugin.settings);
            void this.save();
          }),
      );
      new Setting(containerEl)
        .setName(`${category.label} — custom audio`)
        .setClass("fieldbook-sound-setting")
        .setDesc(
          category.id === "page"
            ? "Leave empty to use the bundled page-turn recording. Choose any audio file in the vault, or import one from this computer."
            : "Leave empty for the built-in sound. Choose any audio file in the vault, or import one from this computer.",
        )
        .addText((text) =>
          text
            .setPlaceholder(category.id === "page" ? "Bundled page-turn recording" : "Built-in sound")
            .setValue(this.plugin.settings.customSounds[category.id] ?? "")
            .onChange((value) => {
              this.plugin.settings.customSounds[category.id] = value.trim();
              this.plugin.audio.updateSettings(this.plugin.settings);
              void this.save();
            }),
        )
        .addButton((button) =>
          button.setButtonText("Choose").onClick(() => {
            new AudioPickerModal(
              this.app,
              (file) => {
                this.plugin.settings.customSounds[category.id] = file.path;
                this.plugin.audio.updateSettings(this.plugin.settings);
                void this.save();
                this.display();
              },
              () => this.importSound(category.id),
            ).open();
          }),
        )
        .addButton((button) =>
          button.setButtonText("Test").onClick(() => {
            this.plugin.audio.play(category.id);
          }),
        )
        .addButton((button) =>
          button.setButtonText("Reset").onClick(() => {
            this.plugin.settings.customSounds[category.id] = "";
            this.plugin.audio.updateSettings(this.plugin.settings);
            void this.save();
            this.display();
          }),
        );
    }

    containerEl.createEl("h3", { text: "Notebook appearance" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Themes, typography, page size, sounds for this notebook and page-turn animation live in the notebook settings panel — open the notebook and press the gear button, or use the command palette.",
    });

    containerEl.createEl("h3", { text: "Structure on disk" });
    const structure = containerEl.createEl("pre", { cls: "fieldbook-settings__tree" });
    structure.setText(
      [
        `${this.plugin.settings.dataFolder}/`,
        "├── journal.json          tabs, page order, settings",
        "├── pages/                one JSON file per page",
        "├── attachments/          imported photographs",
        "└── exports/              Markdown notes and PNG exports",
        "",
        "Every save keeps a .bak copy next to the file. If a JSON file is",
        "unreadable, Fieldbook recovers the backup automatically.",
      ].join("\n"),
    );
  }

  private importSound(category: SoundCategory): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void (async () => {
        const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
        const stem =
          file.name
            .replace(/\.[^.]+$/, "")
            .replace(/[^\p{L}\p{N}_-]+/gu, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "sound";
        const path = this.plugin.storage.path("attachments", "sounds", `${stem}-${Date.now()}.${ext}`);
        try {
          await this.plugin.storage.writeBinary(path, await file.arrayBuffer());
          this.plugin.settings.customSounds[category] = path;
          this.plugin.audio.updateSettings(this.plugin.settings);
          await this.save();
          new Notice(`Fieldbook: ${file.name} is now the ${category} sound.`);
          this.display();
        } catch (error) {
          console.error(error);
          new Notice("Fieldbook: the sound file could not be imported.");
        }
      })();
    });
    input.click();
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  private async validateAttachments(): Promise<void> {
    const store = this.plugin.store as JournalManager;
    let missing = 0;
    let checked = 0;
    for (const id of Object.keys(store.journal.pages)) {
      const page = await store.loadPage(id);
      if (!page) continue;
      for (const el of page.elements) {
        if (el.type !== "image" || !el.attachment) continue;
        checked++;
        if (!this.app.vault.getAbstractFileByPath(el.attachment)) {
          missing++;
          console.warn(`Fieldbook: missing attachment ${el.attachment} on page ${page.title}`);
        }
      }
    }
    new Notice(
      missing
        ? `Fieldbook: ${missing} of ${checked} photo(s) are missing from the vault.`
        : `Fieldbook: all ${checked} photo(s) are present.`,
    );
  }
}
