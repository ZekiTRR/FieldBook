import { setIcon } from "obsidian";
import type {
  AudioElement,
  DecorationElement,
  FontChoice,
  ImageElement,
  LayerId,
  ShapeElement,
  TextElement,
  VoiceMount,
} from "../types";
import { FONT_OPTIONS } from "../types";
import type { PageView, SelectionInfo } from "../page/PageView";
import { colorValue } from "../elements/Renderer";
import { formatVoiceDuration, formatVoiceStamp } from "../elements/VoiceWave";
import { INK_COLORS } from "./Toolbar";

export interface InspectorActions {
  onCopy: () => void;
  onCrop: (image: ImageElement) => void;
  onTape: (image: ImageElement) => void;
  onPlayVoice: (audio: AudioElement) => void;
  isVoicePlaying: (id: string) => boolean;
  refresh: () => void;
}

export class InspectorBar {
  private readonly el: HTMLElement;
  private readonly actions: InspectorActions;
  private pickingColor = false;
  private colorPickOff: (() => void) | null = null;

  constructor(parent: HTMLElement, actions: InspectorActions) {
    this.actions = actions;
    this.el = document.createElement("div");
    this.el.className = "fb-inspector";
    parent.appendChild(this.el);
  }

  render(info: SelectionInfo, view: PageView): void {
    this.el.replaceChildren();
    this.el.classList.toggle("is-visible", info.count > 0);
    if (!info.count) return;
    const first = view.getSelectedElements()[0];
    if (!first) return;

    const lead = document.createElement("div");
    lead.className = "fb-inspector__lead";
    const kindLabel = document.createElement("span");
    kindLabel.className = "fb-inspector__kind";
    kindLabel.textContent = info.count > 1 ? `${info.count} objects` : selectionLabel(info.kind);
    const close = iconButton("x", "Deselect", () => view.clearSelection());
    close.classList.add("fb-inspector__close");
    lead.append(kindLabel, close);
    this.el.appendChild(lead);

    if (info.text) this.buildText(view, info.text);
    else if (info.image) this.buildImage(view, info.image);
    else if (info.shape) this.buildShape(view, info.shape);
    else if (info.decoration) this.buildDecoration(view, info.decoration);
    else if (info.audio) this.buildVoice(view, info.audio);

    this.buildCommon(view, first.opacity, first.rotation, first.layer);

    const actions = document.createElement("div");
    actions.className = "fb-inspector__actions";
    actions.append(
      iconButton("copy", "Copy", () => this.actions.onCopy()),
      iconButton("copy-plus", "Duplicate", () => {
        view.duplicateSelection();
        this.actions.refresh();
      }),
      iconButton("trash-2", "Delete", () => {
        view.deleteSelection();
        this.actions.refresh();
      }),
    );
    this.el.appendChild(actions);
  }

  private buildText(view: PageView, text: TextElement): void {
    const fontGroup = group("Type");
    const fontSelect = document.createElement("select");
    fontSelect.className = "fb-control fb-control--select";
    for (const option of FONT_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = option.id;
      opt.textContent = option.label;
      fontSelect.appendChild(opt);
    }
    fontSelect.value = text.fontFamily;
    fontSelect.addEventListener("change", () => {
      view.updateSelectedText({ fontFamily: fontSelect.value as FontChoice });
    });
    const size = numberField("Size", text.fontSize, 8, 160, (value, commit) => {
      if (commit) view.commitLiveEdit("Font size");
      else {
        view.beginLiveEdit();
        view.applyLivePatch((el) => {
          if (el.type === "text") el.fontSize = value;
        });
      }
    });
    fontGroup.append(fontSelect, size.wrap);
    this.el.appendChild(fontGroup);

    const styleGroup = group("Style");
    styleGroup.append(
      toggleButton("bold", "Bold", text.bold, (next) => view.updateSelectedText({ bold: next })),
      toggleButton("italic", "Italic", text.italic, (next) => view.updateSelectedText({ italic: next })),
      toggleButton("underline", "Underline", text.underline, (next) => view.updateSelectedText({ underline: next })),
      toggleButton("align-left", "Align left", text.align === "left", () => view.updateSelectedText({ align: "left" }), "fb-radio"),
      toggleButton("align-center", "Centre", text.align === "center", () => view.updateSelectedText({ align: "center" }), "fb-radio"),
      toggleButton("align-right", "Align right", text.align === "right", () => view.updateSelectedText({ align: "right" }), "fb-radio"),
    );
    this.el.appendChild(styleGroup);

    const colorGroup = group("Ink");
    colorGroup.appendChild(this.colorSwatches(text.color, (color) => view.updateSelectedText({ color })));
    this.el.appendChild(colorGroup);
  }

  private buildImage(view: PageView, image: ImageElement): void {
    const groupEl = group("Photo");
    groupEl.append(
      toggleButton("square", "Border", image.border, (next) => view.updateSelectedImage({ border: next })),
      toggleButton("sun", "Shadow", image.shadow, (next) => view.updateSelectedImage({ shadow: next })),
      textButton("Crop", () => this.actions.onCrop(image)),
      textButton("Tape", () => this.actions.onTape(image)),
    );
    this.el.appendChild(groupEl);
    const radius = rangeField("Corners", image.radius, 0, 60, 1, (value, commit) => {
      if (commit) view.commitLiveEdit("Photo corners");
      else {
        view.beginLiveEdit();
        view.applyLivePatch((el) => {
          if (el.type === "image") el.radius = value;
        });
      }
    }, "px");
    this.el.appendChild(radius.wrap);
  }

  private buildShape(view: PageView, shape: ShapeElement): void {
    const groupEl = group("Stroke");
    groupEl.appendChild(this.colorSwatches(shape.stroke, (stroke) => view.updateSelectedShape({ stroke })));
    this.el.appendChild(groupEl);

    const fillGroup = group("Fill");
    const fillSelect = document.createElement("select");
    fillSelect.className = "fb-control fb-control--select";
    for (const option of [
      { value: "none", label: "None" },
      { value: "paper", label: "Paper" },
      { value: "accent", label: "Accent" },
      { value: "ink", label: "Ink" },
      { value: "gold", label: "Ochre" },
    ]) {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      fillSelect.appendChild(opt);
    }
    fillSelect.value = shape.fill;
    fillSelect.addEventListener("change", () => view.updateSelectedShape({ fill: fillSelect.value }));
    fillGroup.appendChild(fillSelect);
    fillGroup.append(
      toggleButton("align-horizontal-space-around", "Dashed", shape.dashed, (next) => view.updateSelectedShape({ dashed: next })),
    );
    this.el.appendChild(fillGroup);

    const width = rangeField("Width", shape.strokeWidth, 1, 24, 0.5, (value, commit) => {
      if (commit) view.commitLiveEdit("Stroke width");
      else {
        view.beginLiveEdit();
        view.applyLivePatch((el) => {
          if (el.type === "shape") el.strokeWidth = value;
        });
      }
    }, "px");
    this.el.appendChild(width.wrap);
    if (shape.shape === "polygon") {
      const sides = numberField("Sides", shape.sides, 3, 12, (value) => view.updateSelectedShape({ sides: Math.round(value) }));
      this.el.appendChild(sides.wrap);
    }
  }

  private buildDecoration(view: PageView, deco: DecorationElement): void {
    const groupEl = group("Paper");
    groupEl.appendChild(this.colorSwatches(deco.color, (color) => view.updateSelectedDecoration({ color })));
    this.el.appendChild(groupEl);
    if (deco.decor === "tape" || deco.decor === "bookmark" || deco.decor === "marker" || deco.decor === "sticker") {
      const length = rangeField("Length", Math.round(deco.w), 40, 600, 2, (value, commit) => {
        if (commit) view.commitLiveEdit("Decoration size");
        else {
          view.beginLiveEdit();
          view.applyLivePatch((el) => {
            if (el.type === "decoration") el.w = value;
          });
        }
      }, "px");
      this.el.appendChild(length.wrap);
    }
  }

  private buildVoice(view: PageView, audio: AudioElement): void {
    const playGroup = group("Voice note");
    const playing = this.actions.isVoicePlaying(audio.id);
    const play = iconButton(playing ? "square" : "play", playing ? "Stop" : "Play", () =>
      this.actions.onPlayVoice(audio),
    );
    const readout = document.createElement("span");
    readout.className = "fb-inspector__readout";
    readout.textContent = `${formatVoiceDuration(audio.duration)} \u00b7 ${
      audio.mount === "none" ? "bare" : audio.mount
    }`;
    playGroup.append(play, readout);
    this.el.appendChild(playGroup);

    const captionGroup = group("Caption");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "fb-control";
    input.value = audio.label;
    input.placeholder = formatVoiceStamp(audio.recordedAt) || "What this recording is about";
    input.setAttribute("aria-label", "Caption");
    input.addEventListener("change", () => view.updateSelectedVoice({ label: input.value.trim() }));
    captionGroup.appendChild(input);
    this.el.appendChild(captionGroup);

    const inkGroup = group("Ink");
    inkGroup.appendChild(
      this.colorSwatches(audio.color, (color) => view.updateSelectedVoice({ color })),
    );
    this.el.appendChild(inkGroup);

    const mountGroup = group("Mount");
    const mounts: { id: VoiceMount; label: string }[] = [
      { id: "tape", label: "Tape" },
      { id: "corners", label: "Corners" },
      { id: "none", label: "Bare" },
    ];
    for (const option of mounts) {
      const button = textButton(option.label, () => view.updateSelectedVoice({ mount: option.id }));
      button.classList.toggle("is-active", audio.mount === option.id);
      mountGroup.appendChild(button);
    }
    this.el.appendChild(mountGroup);
  }

  private buildCommon(view: PageView, opacity: number, rotation: number, layer: string): void {
    const opacityField = rangeField("Opacity", Math.round(opacity * 100), 4, 100, 1, (value, commit) => {
      if (commit) view.commitLiveEdit("Opacity");
      else {
        view.beginLiveEdit();
        view.applyLivePatch((el) => {
          el.opacity = value / 100;
        });
      }
    }, "%");
    this.el.appendChild(opacityField.wrap);

    const rotationField = numberField("Angle", Math.round(rotation), -360, 360, (value, commit) => {
      if (commit) view.commitLiveEdit("Rotation");
      else {
        view.beginLiveEdit();
        view.applyLivePatch((el) => {
          el.rotation = value;
        });
      }
    });
    this.el.appendChild(rotationField.wrap);

    const objectWrap = group("Object");
    objectWrap.append(
      toggleButton("pin", "Pin in place", view.getSelectedElements()[0]?.pinned ?? false, () => {
        view.togglePinSelection();
        this.actions.refresh();
      }),
      toggleButton("lock", "Lock", view.getSelectedElements()[0]?.locked ?? false, () => {
        view.toggleLockSelection();
        this.actions.refresh();
      }),
    );
    this.el.appendChild(objectWrap);

    const layerWrap = group("Layer");
    const select = document.createElement("select");
    select.className = "fb-control fb-control--select";
    for (const entry of view.page?.layers ?? []) {
      const opt = document.createElement("option");
      opt.value = entry.id;
      opt.textContent = entry.name;
      select.appendChild(opt);
    }
    select.value = layer;
    select.addEventListener("change", () => {
      view.moveSelectionToLayer(select.value as LayerId);
      this.actions.refresh();
    });
    layerWrap.appendChild(select);
    this.el.appendChild(layerWrap);
  }

  private colorSwatches(current: string, onPick: (color: string) => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "fb-inspector__colors";
    for (const swatch of INK_COLORS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fb-swatch";
      button.title = swatch.label;
      button.style.setProperty("--swatch", colorValue(swatch.color));
      button.style.backgroundColor = colorValue(swatch.color);
      button.classList.toggle("is-active", current === swatch.color);
      button.addEventListener("click", () => onPick(swatch.color));
      wrap.appendChild(button);
    }
    const custom = document.createElement("label");
    custom.className = "fb-swatch fb-swatch--custom";
    custom.title = "Custom colour";
    const input = document.createElement("input");
    input.type = "color";
    if (current.startsWith("#")) input.value = current;
    let safety = 0;
    const release = () => {
      window.clearTimeout(safety);
      document.removeEventListener("pointerdown", onOutside, true);
      if (this.colorPickOff === release) this.colorPickOff = null;
    };
    const endPicking = () => {
      release();
      if (!this.pickingColor) return;
      this.pickingColor = false;
      this.actions.refresh();
    };
    const onOutside = (event: PointerEvent) => {
      if (!custom.contains(event.target as Node)) endPicking();
    };
    const beginPicking = () => {
      this.colorPickOff?.();
      this.pickingColor = true;
      window.clearTimeout(safety);
      safety = window.setTimeout(endPicking, 20000);
      document.removeEventListener("pointerdown", onOutside, true);
      document.addEventListener("pointerdown", onOutside, true);
      this.colorPickOff = release;
    };
    input.addEventListener("pointerdown", beginPicking);
    input.addEventListener("keydown", beginPicking);
    input.addEventListener("input", () => {
      beginPicking();
      onPick(input.value);
    });
    input.addEventListener("change", endPicking);
    input.addEventListener("cancel", endPicking);
    custom.appendChild(input);
    wrap.appendChild(custom);
    return wrap;
  }

  isPickingColor(): boolean {
    return this.pickingColor;
  }

  clear(): void {
    this.colorPickOff?.();
    this.pickingColor = false;
    this.el.replaceChildren();
    this.el.classList.remove("is-visible");
  }

  destroy(): void {
    this.colorPickOff?.();
    this.pickingColor = false;
    this.el.remove();
  }
}

function selectionLabel(kind: SelectionInfo["kind"]): string {
  switch (kind) {
    case "text":
      return "Text";
    case "image":
      return "Photo";
    case "shape":
      return "Shape";
    case "decoration":
      return "Decoration";
    case "drawing":
      return "Ink stroke";
    case "audio":
      return "Voice note";
    case "mixed":
      return "Selection";
    default:
      return "Object";
  }
}

function group(label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fb-inspector__group";
  const title = document.createElement("span");
  title.className = "fb-inspector__label";
  title.textContent = label;
  el.appendChild(title);
  return el;
}

function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fb-inspector__icon";
  button.title = label;
  button.setAttribute("aria-label", label);
  const iconEl = document.createElement("span");
  setIcon(iconEl, icon);
  button.appendChild(iconEl);
  button.addEventListener("click", onClick);
  return button;
}

function toggleButton(
  icon: string,
  label: string,
  active: boolean,
  onClick: (next: boolean) => void,
  extraClass = "fb-toggle",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `fb-inspector__button ${extraClass}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.classList.toggle("is-active", active);
  const iconEl = document.createElement("span");
  setIcon(iconEl, icon);
  button.appendChild(iconEl);
  button.addEventListener("click", () => onClick(!active));
  return button;
}

function textButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fb-inspector__button fb-text-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function numberField(
  labelText: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number, commit: boolean) => void,
): { wrap: HTMLElement } {
  const wrap = document.createElement("label");
  wrap.className = "fb-inspector__number";
  const label = document.createElement("span");
  label.className = "fb-inspector__label";
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.className = "fb-control fb-control--number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(Math.round(value));
  input.addEventListener("input", () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(clampNumber(parsed, min, max), false);
  });
  input.addEventListener("change", () => {
    const parsed = clampNumber(Number(input.value), min, max);
    input.value = String(Math.round(parsed));
    onChange(parsed, true);
  });
  wrap.append(label, input);
  return { wrap };
}

function rangeField(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number, commit: boolean) => void,
  suffix = "",
): { wrap: HTMLElement } {
  const wrap = document.createElement("label");
  wrap.className = "fb-inspector__range";
  const head = document.createElement("span");
  head.className = "fb-inspector__range-head";
  const name = document.createElement("span");
  name.className = "fb-inspector__label";
  name.textContent = label;
  const display = document.createElement("span");
  display.className = "fb-inspector__value";
  display.textContent = `${Math.round(value)}${suffix}`;
  head.append(name, display);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    display.textContent = `${Math.round(Number(input.value))}${suffix}`;
    onChange(Number(input.value), false);
  });
  input.addEventListener("change", () => onChange(Number(input.value), true));
  wrap.append(head, input);
  return { wrap };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
