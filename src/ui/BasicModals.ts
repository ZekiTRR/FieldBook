import { App, FuzzySuggestModal, Modal, Notice, TFile } from "obsidian";

export class PromptModal extends Modal {
  private readonly title: string;
  private readonly label: string;
  private readonly initial: string;
  private readonly placeholder: string;
  private readonly cta: string;
  private readonly onSubmit: (value: string) => void;
  private readonly multiline: boolean;

  constructor(
    app: App,
    options: {
      title: string;
      label?: string;
      value?: string;
      placeholder?: string;
      cta?: string;
      multiline?: boolean;
      onSubmit: (value: string) => void;
    },
  ) {
    super(app);
    this.title = options.title;
    this.label = options.label ?? "";
    this.initial = options.value ?? "";
    this.placeholder = options.placeholder ?? "";
    this.cta = options.cta ?? "Save";
    this.multiline = options.multiline ?? false;
    this.onSubmit = options.onSubmit;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    this.modalEl.addClass("fb-modal-shell");
    contentEl.addClass("fb-modal");
    titleEl.setText(this.title);
    if (this.label) {
      const label = contentEl.createEl("label", { cls: "fb-modal__label", text: this.label });
      label.setAttribute("for", "fb-prompt-input");
    }
    const input = this.multiline
      ? contentEl.createEl("textarea", { cls: "fb-modal__input" })
      : contentEl.createEl("input", { cls: "fb-modal__input", type: "text" });
    input.id = "fb-prompt-input";
    input.value = this.initial;
    input.setAttribute("placeholder", this.placeholder);
    if (this.multiline) (input as HTMLTextAreaElement).rows = 5;
    const buttons = contentEl.createDiv({ cls: "fb-modal__buttons" });
    const cancel = buttons.createEl("button", { text: "Cancel", cls: "fb-button" });
    const submit = buttons.createEl("button", { text: this.cta, cls: "fb-button fb-button--primary" });
    const commit = () => {
      const value = input.value.trim();
      this.close();
      this.onSubmit(value);
    };
    cancel.addEventListener("click", () => this.close());
    submit.addEventListener("click", commit);
    input.addEventListener("keydown", (event) => {
      const keyEvent = event as KeyboardEvent;
      keyEvent.stopPropagation();
      if (keyEvent.key === "Enter" && (!this.multiline || keyEvent.ctrlKey || keyEvent.metaKey)) {
        keyEvent.preventDefault();
        commit();
      }
    });
    window.setTimeout(() => {
      input.focus();
      if (!this.multiline) input.select();
    }, 30);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  private readonly title: string;
  private readonly message: string;
  private readonly cta: string;
  private readonly destructive: boolean;
  private readonly onConfirm: () => void;

  constructor(
    app: App,
    options: {
      title: string;
      message: string;
      cta?: string;
      destructive?: boolean;
      onConfirm: () => void;
    },
  ) {
    super(app);
    this.title = options.title;
    this.message = options.message;
    this.cta = options.cta ?? "Confirm";
    this.destructive = options.destructive ?? false;
    this.onConfirm = options.onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    this.modalEl.addClass("fb-modal-shell");
    contentEl.addClass("fb-modal");
    titleEl.setText(this.title);
    contentEl.createEl("p", { text: this.message, cls: "fb-modal__message" });
    const buttons = contentEl.createDiv({ cls: "fb-modal__buttons" });
    const cancel = buttons.createEl("button", { text: "Cancel", cls: "fb-button" });
    const confirm = buttons.createEl("button", {
      text: this.cta,
      cls: `fb-button ${this.destructive ? "fb-button--danger" : "fb-button--primary"}`,
    });
    cancel.addEventListener("click", () => this.close());
    confirm.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
    window.setTimeout(() => confirm.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"]);

export class ImagePickerModal extends FuzzySuggestModal<TFile> {
  private readonly onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Find an image in your vault\u2026");
    this.modalEl.addClass("fb-modal-shell");
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => IMAGE_EXTENSIONS.has(file.extension.toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }

  onNoSuggestion(): void {
    super.onNoSuggestion();
    new Notice("Fieldbook: no matching image in the vault.");
  }
}

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "webm", "opus"]);

export class AudioPickerModal extends FuzzySuggestModal<TFile> {
  private readonly onChoose: (file: TFile) => void;
  private readonly onImport?: () => void;

  constructor(app: App, onChoose: (file: TFile) => void, onImport?: () => void) {
    super(app);
    this.onChoose = onChoose;
    this.onImport = onImport;
    this.setPlaceholder("Find an audio file in your vault\u2026");
    this.modalEl.addClass("fb-modal-shell");
  }

  onOpen(): void {
    super.onOpen();
    if (!this.onImport) return;
    const footer = this.modalEl.createDiv({ cls: "fb-audio-picker__footer" });
    const importButton = footer.createEl("button", {
      cls: "fb-button",
      text: "Import audio from this computer\u2026",
    });
    importButton.addEventListener("click", () => {
      const callback = this.onImport;
      this.close();
      callback?.();
    });
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => AUDIO_EXTENSIONS.has(file.extension.toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }

  onNoSuggestion(): void {
    super.onNoSuggestion();
    new Notice("Fieldbook: no matching audio file in the vault.");
  }
}

export class FilePickerModal extends FuzzySuggestModal<TFile> {
  private readonly onChoose: (file: TFile) => void;
  private readonly extension: string;

  constructor(app: App, extension: string, onChoose: (file: TFile) => void) {
    super(app);
    this.extension = extension.toLowerCase();
    this.onChoose = onChoose;
    this.setPlaceholder(`Find a .${extension} note\u2026`);
    this.modalEl.addClass("fb-modal-shell");
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === this.extension);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
