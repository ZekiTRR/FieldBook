import { App, Modal } from "obsidian";
import type { JournalManager } from "../core/JournalManager";
import type { JournalSettings, PageBackground, PluginSettings, SoundCategory, ThemeId } from "../types";
import { THEMES } from "../themes";
import { AudioPickerModal, ImagePickerModal, PromptModal } from "./BasicModals";

export interface BookSettingsHost {
  store: JournalManager;
  pluginSettings: PluginSettings;
  updateJournal: (patch: Partial<JournalSettings>) => void;
  updateSound: (patch: Partial<PluginSettings>) => void;
  playSound: (category: SoundCategory) => void;
  resizePages: (width: number, height: number) => void;
  openFullSettings: () => void;
  openPages: () => void;
  importMarkdown: () => void;
  exportPage: () => void;
}

export class BookSettingsModal extends Modal {
  private readonly host: BookSettingsHost;

  constructor(app: App, host: BookSettingsHost) {
    super(app);
    this.host = host;
    this.modalEl.addClass("fb-modal-shell", "fb-settings-modal");
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.addClass("fb-modal");
    titleEl.setText("Notebook settings");
    const settings = this.host.store.getSettings();
    const scroll = contentEl.createDiv({ cls: "fb-settings__scroll" });

    const notebook = this.section(scroll, "Notebook");
    const titleRow = notebook.createDiv({ cls: "fb-setting-row" });
    titleRow.createSpan({ cls: "fb-setting-row__label", text: "Title" });
    const titleValue = titleRow.createSpan({
      cls: "fb-setting-row__value",
      text: this.host.store.journal.title,
    });
    const rename = titleRow.createEl("button", { cls: "fb-button fb-button--small", text: "Rename" });
    rename.addEventListener("click", () => {
      new PromptModal(this.app, {
        title: "Notebook title",
        value: this.host.store.journal.title,
        onSubmit: (value) => {
          this.host.store.setJournalTitle(value);
          titleValue.setText(this.host.store.journal.title);
          this.host.updateJournal({});
        },
      }).open();
    });
    titleRow.append(titleValue, rename);

    const themeRow = notebook.createDiv({ cls: "fb-setting-row" });
    themeRow.createSpan({ cls: "fb-setting-row__label", text: "Theme" });
    const themeSelect = themeRow.createEl("select", { cls: "fb-control" });
    for (const theme of THEMES) {
      const option = themeSelect.createEl("option", { text: theme.name, value: theme.id });
      option.title = theme.description;
    }
    themeSelect.value = settings.theme;
    themeSelect.addEventListener("change", () => {
      this.host.updateJournal({ theme: themeSelect.value as ThemeId });
    });

    const bgRow = notebook.createDiv({ cls: "fb-setting-row" });
    bgRow.createSpan({ cls: "fb-setting-row__label", text: "New page paper" });
    const bgSelect = bgRow.createEl("select", { cls: "fb-control" });
    for (const [value, label] of [
      ["plain", "Plain"],
      ["ruled", "Ruled"],
      ["grid", "Grid"],
      ["dots", "Dots"],
    ] as [PageBackground, string][]) {
      bgSelect.createEl("option", { text: label, value });
    }
    bgSelect.value = settings.defaultBackground;
    bgSelect.addEventListener("change", () => {
      this.host.updateJournal({ defaultBackground: bgSelect.value as PageBackground });
    });

    const typography = this.section(scroll, "Typography");
    const titleFont = this.textRow(typography, "Heading font", settings.titleFont, "Theme default");
    titleFont.addEventListener("change", () => {
      this.host.updateJournal({ titleFont: titleFont.value });
    });
    const bodyFont = this.textRow(typography, "Body font", settings.bodyFont, "Theme default");
    bodyFont.addEventListener("change", () => {
      this.host.updateJournal({ bodyFont: bodyFont.value });
    });
    const texture = this.textRow(
      typography,
      "Paper texture",
      settings.customPaperTexture,
      "Choose a paper image from your vault",
    );
    texture.addEventListener("change", () => {
      this.host.updateJournal({ customPaperTexture: texture.value.trim() });
    });
    const textureRow = texture.parentElement as HTMLElement;
    const chooseTexture = textureRow.createEl("button", {
      cls: "fb-button fb-button--small",
      text: "Choose",
    });
    chooseTexture.addEventListener("click", () => {
      new ImagePickerModal(this.app, (file) => {
        texture.value = file.path;
        this.host.updateJournal({ customPaperTexture: file.path });
      }).open();
    });
    const clearTexture = textureRow.createEl("button", {
      cls: "fb-button fb-button--small",
      text: "Clear",
    });
    clearTexture.addEventListener("click", () => {
      texture.value = "";
      this.host.updateJournal({ customPaperTexture: "" });
    });
    const textureName = textureRow.querySelector<HTMLElement>(".fb-setting-row__label");
    if (textureName) textureName.title = "Use any image in the vault as the notebook paper texture.";

    const book = this.section(scroll, "Book");
    const animationRow = book.createDiv({ cls: "fb-setting-row" });
    const animationLabel = animationRow.createEl("label", { cls: "fb-check" });
    const animationInput = animationLabel.createEl("input", { type: "checkbox" });
    animationInput.checked = settings.flipAnimation;
    animationLabel.createSpan({ text: "Page-turn animation" });
    animationInput.addEventListener("change", () => {
      this.host.updateJournal({ flipAnimation: animationInput.checked });
    });
    this.rangeRow(
      book,
      "Turn speed",
      settings.flipDuration,
      150,
      1500,
      10,
      (value) => this.host.updateJournal({ flipDuration: value }),
      "ms",
    );
    this.rangeRow(
      book,
      "Notebook size",
      Math.round((settings.bookScale ?? 1) * 100),
      50,
      100,
      1,
      (value) => this.host.updateJournal({ bookScale: value / 100 }),
      "%",
    );
    const bookSizeHint = book.createDiv({
      cls: "fb-setting-hint",
      text: "100% fills the workspace. Use focus mode for an even larger page.",
    });
    void bookSizeHint;
    const numbersRow = book.createDiv({ cls: "fb-setting-row" });
    const numbersLabel = numbersRow.createEl("label", { cls: "fb-check" });
    const numbersInput = numbersLabel.createEl("input", { type: "checkbox" });
    numbersInput.checked = settings.showPageNumbers;
    numbersLabel.createSpan({ text: "Page numbers" });
    numbersInput.addEventListener("change", () => {
      this.host.updateJournal({ showPageNumbers: numbersInput.checked });
    });
    const snapRow = book.createDiv({ cls: "fb-setting-row" });
    const snapLabel = snapRow.createEl("label", { cls: "fb-check" });
    const snapInput = snapLabel.createEl("input", { type: "checkbox" });
    snapInput.checked = settings.snapToGrid;
    snapLabel.createSpan({ text: "Snap to grid" });
    snapInput.addEventListener("change", () => {
      this.host.updateJournal({ snapToGrid: snapInput.checked });
    });
    this.rangeRow(
      book,
      "Grid size",
      settings.gridSize,
      4,
      120,
      2,
      (value) => this.host.updateJournal({ gridSize: value }),
      "px",
    );

    const sizeRow = book.createDiv({ cls: "fb-setting-row fb-setting-row--stack" });
    sizeRow.createSpan({ cls: "fb-setting-row__label", text: "Page size" });
    const sizeControls = sizeRow.createDiv({ cls: "fb-setting-inline" });
    const widthInput = sizeControls.createEl("input", { cls: "fb-control fb-control--number", type: "number" });
    widthInput.value = String(settings.pageWidth);
    widthInput.min = "400";
    widthInput.max = "4000";
    const times = sizeControls.createSpan({ cls: "fb-setting-times", text: "\u00d7" });
    const heightInput = sizeControls.createEl("input", { cls: "fb-control fb-control--number", type: "number" });
    heightInput.value = String(settings.pageHeight);
    heightInput.min = "400";
    heightInput.max = "6000";
    const applySize = sizeControls.createEl("button", { cls: "fb-button fb-button--small", text: "Apply & scale" });
    applySize.addEventListener("click", () => {
      const width = Math.max(400, Math.min(4000, Number(widthInput.value) || settings.pageWidth));
      const height = Math.max(400, Math.min(6000, Number(heightInput.value) || settings.pageHeight));
      this.host.resizePages(width, height);
    });
    sizeControls.append(widthInput, times, heightInput, applySize);
    const sizeHint = sizeRow.createDiv({
      cls: "fb-setting-hint",
      text: "Changes the virtual page size and scales every element on all pages.",
    });

    const autosaveRow = book.createDiv({ cls: "fb-setting-row" });
    autosaveRow.createSpan({ cls: "fb-setting-row__label", text: "Autosave delay" });
    const autosaveInput = autosaveRow.createEl("input", {
      cls: "fb-control fb-control--number",
      type: "number",
    });
    autosaveInput.value = String(settings.autosaveDelay);
    autosaveInput.min = "150";
    autosaveInput.max = "10000";
    autosaveRow.appendChild(autosaveInput);
    autosaveInput.addEventListener("change", () => {
      this.host.updateJournal({
        autosaveDelay: Math.max(150, Math.min(10000, Number(autosaveInput.value) || 800)),
      });
    });

    const sound = this.section(scroll, "Sound");
    const soundRow = sound.createDiv({ cls: "fb-setting-row" });
    const soundLabel = soundRow.createEl("label", { cls: "fb-check" });
    const soundInput = soundLabel.createEl("input", { type: "checkbox" });
    soundInput.checked = this.host.pluginSettings.soundEnabled;
    soundLabel.createSpan({ text: "Paper sounds" });
    soundInput.addEventListener("change", () => {
      this.host.updateSound({ soundEnabled: soundInput.checked });
    });
    this.rangeRow(
      sound,
      "Master volume",
      Math.round(this.host.pluginSettings.masterVolume * 100),
      0,
      100,
      1,
      (value) => this.host.updateSound({ masterVolume: value / 100 }),
      "%",
    );
    const typingRow = sound.createDiv({ cls: "fb-setting-row" });
    const typingLabel = typingRow.createEl("label", { cls: "fb-check" });
    const typingInput = typingLabel.createEl("input", { type: "checkbox" });
    typingInput.checked = this.host.pluginSettings.typingSoundEnabled ?? true;
    typingLabel.createSpan({ text: "Keyboard writing sound" });
    typingInput.addEventListener("change", () => {
      this.host.updateSound({ typingSoundEnabled: typingInput.checked });
    });

    const pageRow = sound.createDiv({ cls: "fb-setting-row" });
    pageRow.createSpan({ cls: "fb-setting-row__label", text: "Page-turn sound" });
    const pageValue = pageRow.createSpan({
      cls: "fb-setting-row__value",
      text: this.soundLabel(this.host.pluginSettings.customSounds.page),
    });
    pageValue.title = this.host.pluginSettings.customSounds.page || "Bundled page-turn recording";
    const choosePage = pageRow.createEl("button", { cls: "fb-button fb-button--small", text: "Choose" });
    choosePage.addEventListener("click", () => {
      new AudioPickerModal(this.app, (file) => {
        this.host.updateSound({
          customSounds: { ...this.host.pluginSettings.customSounds, page: file.path },
        });
        pageValue.setText(this.soundLabel(file.path));
        pageValue.title = file.path;
      }).open();
    });
    const resetPage = pageRow.createEl("button", { cls: "fb-button fb-button--small", text: "Default" });
    resetPage.addEventListener("click", () => {
      this.host.updateSound({
        customSounds: { ...this.host.pluginSettings.customSounds, page: "" },
      });
      pageValue.setText("Bundled recording");
      pageValue.title = "Bundled page-turn recording";
    });
    const testPage = pageRow.createEl("button", { cls: "fb-button fb-button--small", text: "Test" });
    testPage.addEventListener("click", () => this.host.playSound("page"));

    sound.createDiv({
      cls: "fb-setting-hint",
      text: "Page turns use the bundled recording unless you choose another file. Import audio and fine-tune volumes in the Fieldbook plugin settings.",
    });

    const actions = this.section(scroll, "Actions");
    const actionRow = actions.createDiv({ cls: "fb-settings__actions" });
    const pages = actionRow.createEl("button", { cls: "fb-button", text: "Pages & trash" });
    pages.addEventListener("click", () => {
      this.close();
      this.host.openPages();
    });
    const importButton = actionRow.createEl("button", { cls: "fb-button", text: "Import Markdown" });
    importButton.addEventListener("click", () => {
      this.close();
      this.host.importMarkdown();
    });
    const exportButton = actionRow.createEl("button", { cls: "fb-button", text: "Export page" });
    exportButton.addEventListener("click", () => {
      this.close();
      this.host.exportPage();
    });
    const full = actionRow.createEl("button", { cls: "fb-button fb-button--primary", text: "All plugin settings" });
    full.addEventListener("click", () => {
      this.close();
      this.host.openFullSettings();
    });
    void sizeHint;
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const section = parent.createDiv({ cls: "fb-settings__section" });
    section.createDiv({ cls: "fb-settings__section-title", text: title });
    return section;
  }

  private soundLabel(path: string): string {
    const clean = path.trim();
    if (!clean) return "Bundled recording";
    const name = clean.split("/").pop() ?? clean;
    return name.length > 42 ? `${name.slice(0, 39)}\u2026` : name;
  }

  private textRow(parent: HTMLElement, label: string, value: string, placeholder: string): HTMLInputElement {
    const row = parent.createDiv({ cls: "fb-setting-row" });
    row.createSpan({ cls: "fb-setting-row__label", text: label });
    const input = row.createEl("input", { cls: "fb-control fb-control--wide", type: "text" });
    input.value = value;
    input.placeholder = placeholder;
    return input;
  }

  private rangeRow(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
    suffix = "",
  ): void {
    const row = parent.createDiv({ cls: "fb-setting-row fb-setting-row--range" });
    row.createSpan({ cls: "fb-setting-row__label", text: label });
    const wrap = row.createDiv({ cls: "fb-setting-range" });
    const input = wrap.createEl("input", { type: "range" });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const display = wrap.createSpan({ cls: "fb-setting-range__value", text: `${Math.round(value)}${suffix}` });
    input.addEventListener("input", () => {
      display.setText(`${Math.round(Number(input.value))}${suffix}`);
    });
    input.addEventListener("change", () => onChange(Number(input.value)));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
