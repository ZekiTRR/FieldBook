import { setIcon } from "obsidian";
import type { ActiveTool, BrushKind, BrushSettings, DecorKind, ShapeKind } from "../types";
import type { ToolState } from "../page/PageView";
import { colorValue } from "../elements/Renderer";
import { openPopover, popoverDivider, popoverHeading, popoverItem } from "./Popover";

export const INK_COLORS: { color: string; label: string }[] = [
  { color: "ink", label: "Ink" },
  { color: "navy", label: "Navy" },
  { color: "ocean", label: "Ocean" },
  { color: "forest", label: "Forest" },
  { color: "rust", label: "Rust" },
  { color: "plum", label: "Plum" },
  { color: "gold", label: "Ochre" },
  { color: "graphite", label: "Graphite" },
  { color: "crimson", label: "Crimson" },
  { color: "white", label: "Chalk" },
];

export interface ToolbarActions {
  getTool(): ToolState;
  onTool(tool: ActiveTool): void;
  onBrush(brush: BrushKind | "eraser"): void;
  onBrushPatch(patch: Partial<BrushSettings>): void;
  onEraserSize(value: number): void;
  onShape(shape: ShapeKind): void;
  onDecor(kind: DecorKind): void;
  onImageUpload(): void;
  onImageVault(): void;
  onUndo(): void;
  onRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  onLayers(anchor: HTMLElement): void;
  onPages(): void;
  onExport(anchor: HTMLElement): void;
  onImport(): void;
  onSettings(): void;
  onFocus(): void;
}

interface RailButton {
  id: string;
  icon: string;
  label: string;
  action: (button: HTMLElement) => void;
  separatorBefore?: boolean;
}

export class Toolbar {
  private readonly actions: ToolbarActions;
  private railEl: HTMLElement;
  private dockEl: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private undoButton: HTMLButtonElement | null = null;
  private redoButton: HTMLButtonElement | null = null;
  private dockKey = "";
  private sizeLabel: HTMLElement | null = null;
  private opacityLabel: HTMLElement | null = null;
  private colorInput: HTMLInputElement | null = null;

  constructor(parent: HTMLElement, actions: ToolbarActions) {
    this.actions = actions;
    this.railEl = document.createElement("nav");
    this.railEl.className = "fb-rail";
    this.railEl.setAttribute("aria-label", "Fieldbook tools");
    this.dockEl = document.createElement("div");
    this.dockEl.className = "fb-brush-dock";
    parent.append(this.railEl, this.dockEl);
    this.buildRail();
    this.update();
  }

  private buildRail(): void {
    const definitions: RailButton[] = [
      { id: "select", icon: "mouse-pointer", label: "Select (V)", action: () => this.actions.onTool("select") },
      { id: "text", icon: "type", label: "Text (T)", action: () => this.actions.onTool("text") },
      {
        id: "image",
        icon: "image-plus",
        label: "Add photo",
        action: (button) => this.imageMenu(button),
      },
      {
        id: "shape",
        icon: "shapes",
        label: "Shapes",
        action: (button) => this.shapeMenu(button),
      },
      { id: "draw", icon: "pen-tool", label: "Draw (P)", action: () => this.actions.onTool("draw") },
      { id: "eraser", icon: "eraser", label: "Eraser (E)", action: () => this.actions.onBrush("eraser") },
      {
        id: "decorate",
        icon: "sticker",
        label: "Decorations",
        action: (button) => this.decorMenu(button),
      },
      { id: "undo", icon: "undo-2", label: "Undo (Ctrl+Z)", action: () => this.actions.onUndo(), separatorBefore: true },
      { id: "redo", icon: "redo-2", label: "Redo (Ctrl+Shift+Z)", action: () => this.actions.onRedo() },
      { id: "layers", icon: "layers", label: "Layers", action: (button) => this.actions.onLayers(button), separatorBefore: true },
      { id: "pages", icon: "library", label: "Pages & tabs", action: () => this.actions.onPages() },
      { id: "import", icon: "file-input", label: "Import Markdown", action: () => this.actions.onImport(), separatorBefore: true },
      { id: "export", icon: "download", label: "Export page", action: (button) => this.actions.onExport(button) },
      { id: "focus", icon: "maximize", label: "Focus mode", action: () => this.actions.onFocus(), separatorBefore: true },
      { id: "settings", icon: "settings", label: "Notebook settings", action: () => this.actions.onSettings() },
    ];
    for (const def of definitions) {
      if (def.separatorBefore) {
        const sep = document.createElement("div");
        sep.className = "fb-rail__separator";
        this.railEl.appendChild(sep);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fb-rail__button";
      button.dataset.tool = def.id;
      button.setAttribute("aria-label", def.label);
      button.title = def.label;
      const icon = document.createElement("span");
      icon.className = "fb-rail__icon";
      setIcon(icon, def.icon);
      button.appendChild(icon);
      button.addEventListener("click", () => def.action(button));
      this.railEl.appendChild(button);
      this.buttons.set(def.id, button);
      if (def.id === "undo") this.undoButton = button;
      if (def.id === "redo") this.redoButton = button;
    }
  }

  update(): void {
    const tool = this.actions.getTool();
    const active: Record<string, boolean> = {
      select: tool.tool === "select",
      text: tool.tool === "text",
      shape: tool.tool === "shape",
      draw: tool.tool === "draw" && tool.brush !== "eraser",
      eraser: tool.tool === "draw" && tool.brush === "eraser",
      decorate: tool.tool === "decorate",
    };
    for (const [id, button] of this.buttons) {
      button.classList.toggle("is-active", !!active[id]);
    }
    if (this.undoButton) this.undoButton.disabled = !this.actions.canUndo();
    if (this.redoButton) this.redoButton.disabled = !this.actions.canRedo();
    const key = `${tool.tool}:${tool.brush}`;
    const shouldShow = tool.tool === "draw";
    this.dockEl.classList.toggle("is-visible", shouldShow);
    if (shouldShow && key !== this.dockKey) {
      this.dockKey = key;
      this.buildDock(tool);
    } else if (!shouldShow) {
      this.dockKey = "";
      this.dockEl.innerHTML = "";
    }
    if (shouldShow) this.syncDockValues(tool);
  }

  private buildDock(tool: ToolState): void {
    this.dockEl.innerHTML = "";
    this.sizeLabel = null;
    this.opacityLabel = null;
    this.colorInput = null;
    const eraser = tool.brush === "eraser";
    const header = document.createElement("div");
    header.className = "fb-dock__header";
    const title = document.createElement("span");
    title.className = "fb-dock__title";
    title.textContent = eraser ? "Eraser" : "Ink";
    const hint = document.createElement("span");
    hint.className = "fb-dock__hint";
    hint.textContent = eraser ? "Lift strokes" : brushLabel(tool.brush);
    header.append(title, hint);
    this.dockEl.appendChild(header);

    if (!eraser) {
      const brushes = document.createElement("div");
      brushes.className = "fb-dock__brushes";
      const defs: { id: BrushKind; icon: string; label: string }[] = [
        { id: "pen", icon: "pen", label: "Pen" },
        { id: "pencil", icon: "pencil", label: "Pencil" },
        { id: "marker", icon: "highlighter", label: "Marker" },
        { id: "highlighter", icon: "paint-bucket", label: "Highlighter" },
      ];
      for (const def of defs) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fb-dock__brush";
        button.dataset.brush = def.id;
        button.title = def.label;
        const icon = document.createElement("span");
        setIcon(icon, def.icon);
        const label = document.createElement("span");
        label.textContent = def.label;
        button.append(icon, label);
        button.classList.toggle("is-active", tool.brush === def.id);
        button.addEventListener("click", () => this.actions.onBrush(def.id));
        brushes.appendChild(button);
      }
      this.dockEl.appendChild(brushes);

      const colors = document.createElement("div");
      colors.className = "fb-dock__colors";
      for (const swatch of INK_COLORS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fb-swatch";
        button.dataset.color = swatch.color;
        button.title = swatch.label;
        button.style.setProperty("--swatch", colorValue(swatch.color));
        button.style.backgroundColor = colorValue(swatch.color);
        button.addEventListener("click", () => {
          this.actions.onBrushPatch({ color: swatch.color });
          this.syncDockValues(this.actions.getTool());
        });
        colors.appendChild(button);
      }
      const custom = document.createElement("label");
      custom.className = "fb-swatch fb-swatch--custom";
      custom.title = "Custom colour";
      this.colorInput = document.createElement("input");
      this.colorInput.type = "color";
      this.colorInput.addEventListener("input", () => {
        this.actions.onBrushPatch({ color: this.colorInput?.value ?? "#222222" });
      });
      custom.appendChild(this.colorInput);
      colors.appendChild(custom);
      this.dockEl.appendChild(colors);

      const sizeRow = this.buildRange(
        "Size",
        Math.round(tool.brushSettings.size),
        1,
        60,
        0.5,
        (value) => {
          this.actions.onBrushPatch({ size: value });
          if (this.sizeLabel) this.sizeLabel.textContent = `${Math.round(value)}`;
        },
        (label) => (this.sizeLabel = label),
      );
      this.dockEl.appendChild(sizeRow);
      const opacityRow = this.buildRange(
        "Flow",
        Math.round(tool.brushSettings.opacity * 100),
        4,
        100,
        1,
        (value) => {
          this.actions.onBrushPatch({ opacity: value / 100 });
          if (this.opacityLabel) this.opacityLabel.textContent = `${Math.round(value)}%`;
        },
        (label) => (this.opacityLabel = label),
        "%",
      );
      this.dockEl.appendChild(opacityRow);

      if (tool.brush === "pen" || tool.brush === "pencil") {
        const pressureRow = document.createElement("label");
        pressureRow.className = "fb-dock__toggle";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = tool.brushSettings.pressure;
        input.addEventListener("change", () => this.actions.onBrushPatch({ pressure: input.checked }));
        const text = document.createElement("span");
        text.textContent = "Pen pressure";
        pressureRow.append(input, text);
        this.dockEl.appendChild(pressureRow);
      }
    } else {
      const eraserRow = this.buildRange(
        "Size",
        Math.round(tool.eraserSize),
        6,
        140,
        1,
        (value) => {
          this.actions.onEraserSize(value);
          if (this.sizeLabel) this.sizeLabel.textContent = `${Math.round(value)}`;
        },
        (label) => (this.sizeLabel = label),
      );
      this.dockEl.appendChild(eraserRow);
      const note = document.createElement("div");
      note.className = "fb-dock__note";
      note.textContent = "Erases whole ink strokes. Ctrl+Z restores them.";
      this.dockEl.appendChild(note);
    }
  }

  private buildRange(
    labelText: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onInput: (value: number) => void,
    registerLabel: (label: HTMLElement) => void,
    suffix = "",
  ): HTMLElement {
    const row = document.createElement("label");
    row.className = "fb-dock__range";
    const head = document.createElement("span");
    head.className = "fb-dock__range-head";
    const label = document.createElement("span");
    label.textContent = labelText;
    const valueEl = document.createElement("span");
    valueEl.className = "fb-dock__value";
    valueEl.textContent = `${Math.round(value)}${suffix}`;
    registerLabel(valueEl);
    head.append(label, valueEl);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => onInput(Number(input.value)));
    row.append(head, input);
    return row;
  }

  private syncDockValues(tool: ToolState): void {
    if (!this.dockEl.classList.contains("is-visible")) return;
    for (const button of Array.from(this.dockEl.querySelectorAll<HTMLElement>("[data-brush]"))) {
      button.classList.toggle("is-active", button.dataset.brush === tool.brush);
    }
    for (const button of Array.from(this.dockEl.querySelectorAll<HTMLElement>(".fb-swatch[data-color]"))) {
      button.classList.toggle("is-active", button.dataset.color === tool.brushSettings.color);
    }
    if (this.sizeLabel) this.sizeLabel.textContent = `${Math.round(tool.brush === "eraser" ? tool.eraserSize : tool.brushSettings.size)}`;
    if (this.opacityLabel) this.opacityLabel.textContent = `${Math.round(tool.brushSettings.opacity * 100)}%`;
    if (this.colorInput && tool.brush !== "eraser" && tool.brushSettings.color.startsWith("#")) {
      this.colorInput.value = tool.brushSettings.color;
    }
    const ranges = this.dockEl.querySelectorAll<HTMLInputElement>('input[type="range"]');
    if (ranges[0]) ranges[0].value = String(tool.brush === "eraser" ? tool.eraserSize : tool.brushSettings.size);
    if (ranges[1]) ranges[1].value = String(Math.round(tool.brushSettings.opacity * 100));
  }

  private shapeMenu(anchor: HTMLElement): void {
    openPopover(anchor, (host, close) => {
      popoverHeading(host, "Shape");
      const shapes: { id: ShapeKind; icon: string; label: string }[] = [
        { id: "line", icon: "minus", label: "Line" },
        { id: "arrow", icon: "move-up-right", label: "Arrow" },
        { id: "rect", icon: "square", label: "Rectangle" },
        { id: "ellipse", icon: "circle", label: "Circle" },
        { id: "polygon", icon: "pentagon", label: "Polygon" },
      ];
      for (const shape of shapes) {
        popoverItem(host, shape.icon, shape.label, () => {
          close();
          this.actions.onShape(shape.id);
        });
      }
      popoverDivider(host);
      const hint = document.createElement("div");
      hint.className = "fb-popover__note";
      hint.textContent = "Drag on the page to draw the shape.";
      host.appendChild(hint);
    });
  }

  private decorMenu(anchor: HTMLElement): void {
    openPopover(anchor, (host, close) => {
      popoverHeading(host, "Paper & tape");
      const items: { id: DecorKind; icon: string; label: string }[] = [
        { id: "tape", icon: "rectangle-horizontal", label: "Tape strip" },
        { id: "sticker", icon: "sticker", label: "Sticker" },
        { id: "bookmark", icon: "bookmark", label: "Bookmark" },
        { id: "frame", icon: "frame", label: "Frame" },
        { id: "marker", icon: "highlighter", label: "Highlight strip" },
        { id: "photoCorner", icon: "corner-up-left", label: "Photo corners" },
      ];
      for (const item of items) {
        popoverItem(host, item.icon, item.label, () => {
          close();
          this.actions.onDecor(item.id);
        });
      }
      popoverDivider(host);
      const hint = document.createElement("div");
      hint.className = "fb-popover__note";
      hint.textContent = "Click a page to place it. Tape can be attached from a photo's context menu.";
      host.appendChild(hint);
    });
  }

  private imageMenu(anchor: HTMLElement): void {
    openPopover(anchor, (host, close) => {
      popoverHeading(host, "Add a photograph");
      popoverItem(host, "upload", "Upload from computer", () => {
        close();
        this.actions.onImageUpload();
      });
      popoverItem(host, "folder-open", "Choose from vault", () => {
        close();
        this.actions.onImageVault();
      });
      popoverDivider(host);
      const hint = document.createElement("div");
      hint.className = "fb-popover__note";
      hint.textContent = "You can also drop an image onto a page or paste it with Ctrl+V.";
      host.appendChild(hint);
    }, { align: "left" });
  }

  destroy(): void {
    this.railEl.remove();
    this.dockEl.remove();
    this.buttons.clear();
  }
}

function brushLabel(brush: BrushKind | "eraser"): string {
  switch (brush) {
    case "pencil":
      return "Graphite";
    case "marker":
      return "Bold marker";
    case "highlighter":
      return "Soft wash";
    case "eraser":
      return "Eraser";
    default:
      return "Fine pen";
  }
}
