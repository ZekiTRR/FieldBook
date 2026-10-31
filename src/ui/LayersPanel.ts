import { setIcon } from "obsidian";
import type { LayerId } from "../types";
import type { PageView } from "../page/PageView";
import { openPopover, popoverHeading } from "./Popover";

const LAYER_ICONS: Record<LayerId, string> = {
  background: "image",
  content: "type",
  drawings: "pen-tool",
  decorations: "sticker",
};

export function openLayersPanel(anchor: HTMLElement, view: PageView | null): void {
  if (!view || !view.page) return;
  const handle = openPopover(
    anchor,
    (host) => {
      const render = () => {
        host.innerHTML = "";
        popoverHeading(host, "Layers");
        const page = view.page;
        if (!page) return;
        const layers = page.layers.slice().reverse();
        for (const layer of layers) {
          const row = document.createElement("div");
          row.className = "fb-layer-row";
          row.classList.toggle("is-hidden", !layer.visible);
          const icon = document.createElement("span");
          icon.className = "fb-layer-row__icon";
          setIcon(icon, LAYER_ICONS[layer.id] ?? "layers");
          const labelWrap = document.createElement("div");
          labelWrap.className = "fb-layer-row__label";
          const name = document.createElement("span");
          name.className = "fb-layer-row__name";
          name.textContent = layer.name;
          const count = document.createElement("span");
          count.className = "fb-layer-row__count";
          const total = page.elements.filter((el) => el.layer === layer.id).length;
          count.textContent = `${total} object${total === 1 ? "" : "s"}`;
          labelWrap.append(name, count);
          const visibility = iconButton(layer.visible ? "eye" : "eye-off", layer.visible ? "Hide layer" : "Show layer", () => {
            view.setLayerVisible(layer.id, !layer.visible);
            render();
          });
          visibility.classList.toggle("is-active", layer.visible);
          const lock = iconButton(layer.locked ? "lock" : "unlock", layer.locked ? "Unlock layer" : "Lock layer", () => {
            view.setLayerLocked(layer.id, !layer.locked);
            render();
          });
          lock.classList.toggle("is-active", layer.locked);
          const up = iconButton("chevron-up", "Move layer up", () => {
            view.moveLayer(layer.id, 1);
            render();
          });
          const down = iconButton("chevron-down", "Move layer down", () => {
            view.moveLayer(layer.id, -1);
            render();
          });
          const index = page.layers.findIndex((entry) => entry.id === layer.id);
          up.disabled = index === page.layers.length - 1;
          down.disabled = index === 0;
          row.append(icon, labelWrap, visibility, lock, up, down);
          host.appendChild(row);
        }
        const note = document.createElement("div");
        note.className = "fb-popover__note";
        note.textContent =
          "Layer order controls what sits on top of the paper. Locked layers stay visible but cannot be edited.";
        host.appendChild(note);
      };
      render();
    },
    { width: 286, align: "left", className: "fb-layers-popover" },
  );
  void handle;
}

function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fb-icon-button fb-layer-row__button";
  button.title = label;
  button.setAttribute("aria-label", label);
  setIcon(button, icon);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}
