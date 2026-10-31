import { App, Modal } from "obsidian";
import type { CropRect } from "../types";

const MIN_CROP = 0.06;

export class CropModal extends Modal {
  private readonly imageUrl: string;
  private readonly naturalW: number;
  private readonly naturalH: number;
  private readonly onApply: (crop: CropRect) => void;
  private crop: CropRect;
  private boxEl: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;

  constructor(
    app: App,
    options: {
      imageUrl: string;
      naturalW: number;
      naturalH: number;
      crop: CropRect;
      onApply: (crop: CropRect) => void;
    },
  ) {
    super(app);
    this.imageUrl = options.imageUrl;
    this.naturalW = options.naturalW || 4;
    this.naturalH = options.naturalH || 3;
    this.crop = { ...options.crop };
    this.onApply = options.onApply;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    this.modalEl.addClass("fb-modal-shell", "fb-crop-modal");
    contentEl.addClass("fb-modal");
    titleEl.setText("Crop photograph");
    const stageWrap = contentEl.createDiv({ cls: "fb-crop" });
    const maxW = Math.min(640, window.innerWidth - 140);
    const ratio = this.naturalW / this.naturalH;
    let width = maxW;
    let height = width / ratio;
    if (height > window.innerHeight - 260) {
      height = window.innerHeight - 260;
      width = height * ratio;
    }
    const stage = stageWrap.createDiv({ cls: "fb-crop__stage" });
    stage.style.width = `${Math.max(220, width)}px`;
    stage.style.height = `${Math.max(180, height)}px`;
    this.stageEl = stage;
    const img = stage.createEl("img", { cls: "fb-crop__image" });
    img.src = this.imageUrl;
    img.draggable = false;
    const box = stage.createDiv({ cls: "fb-crop__box" });
    this.boxEl = box;
    for (const corner of ["nw", "ne", "se", "sw"]) {
      const handle = box.createDiv({ cls: `fb-crop__handle fb-crop__handle--${corner}` });
      handle.dataset.corner = corner;
    }
    const grid = box.createDiv({ cls: "fb-crop__grid" });
    grid.setAttribute("aria-hidden", "true");
    stage.addEventListener("pointerdown", this.onPointerDown);
    contentEl.createDiv({
      cls: "fb-crop__hint",
      text: "Drag the frame or its corners. Crop only changes how the photo sits on the page.",
    });
    const buttons = contentEl.createDiv({ cls: "fb-modal__buttons" });
    const reset = buttons.createEl("button", { text: "Reset", cls: "fb-button" });
    const cancel = buttons.createEl("button", { text: "Cancel", cls: "fb-button" });
    const apply = buttons.createEl("button", { text: "Apply crop", cls: "fb-button fb-button--primary" });
    reset.addEventListener("click", () => {
      this.crop = { x: 0, y: 0, w: 1, h: 1 };
      this.layoutBox();
    });
    cancel.addEventListener("click", () => this.close());
    apply.addEventListener("click", () => {
      this.onApply({ ...this.crop });
      this.close();
    });
    this.layoutBox();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.stageEl) return;
    const target = event.target as HTMLElement;
    const corner = target.dataset.corner as "nw" | "ne" | "se" | "sw" | undefined;
    const inside = this.boxEl?.contains(target) || target === this.boxEl;
    if (!corner && !inside) return;
    event.preventDefault();
    event.stopPropagation();
    const stageRect = this.stageEl.getBoundingClientRect();
    const start = {
      nx: (event.clientX - stageRect.left) / stageRect.width,
      ny: (event.clientY - stageRect.top) / stageRect.height,
    };
    const initial = { ...this.crop };
    const move = (moveEvent: PointerEvent) => {
      const nx = (moveEvent.clientX - stageRect.left) / stageRect.width;
      const ny = (moveEvent.clientY - stageRect.top) / stageRect.height;
      const dx = nx - start.nx;
      const dy = ny - start.ny;
      if (!corner) {
        this.crop.x = clamp(initial.x + dx, 0, 1 - initial.w);
        this.crop.y = clamp(initial.y + dy, 0, 1 - initial.h);
      } else {
        let left = initial.x;
        let top = initial.y;
        let right = initial.x + initial.w;
        let bottom = initial.y + initial.h;
        if (corner.includes("w")) left = clamp(initial.x + dx, 0, right - MIN_CROP);
        if (corner.includes("e")) right = clamp(initial.x + initial.w + dx, left + MIN_CROP, 1);
        if (corner.includes("n")) top = clamp(initial.y + dy, 0, bottom - MIN_CROP);
        if (corner.includes("s")) bottom = clamp(initial.y + initial.h + dy, top + MIN_CROP, 1);
        this.crop = { x: left, y: top, w: right - left, h: bottom - top };
      }
      this.layoutBox();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  private layoutBox(): void {
    if (!this.boxEl) return;
    this.boxEl.style.left = `${this.crop.x * 100}%`;
    this.boxEl.style.top = `${this.crop.y * 100}%`;
    this.boxEl.style.width = `${this.crop.w * 100}%`;
    this.boxEl.style.height = `${this.crop.h * 100}%`;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
