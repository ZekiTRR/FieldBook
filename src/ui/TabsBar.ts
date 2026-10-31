import { setIcon } from "obsidian";
import type { TabData, ThemeId } from "../types";
import { tabColorValue } from "../themes";

export interface TabsActions {
  getTabs(): TabData[];
  getActiveTabId(): string | null;
  getTheme(): ThemeId;
  onSelect(tabId: string): void;
  onAdd(): void;
  onContextMenu(event: MouseEvent, tab: TabData): void;
  onReorder(tabId: string, targetIndex: number): void;
}

export class TabsBar {
  private readonly el: HTMLElement;
  private readonly actions: TabsActions;
  private dragId: string | null = null;

  constructor(parent: HTMLElement, actions: TabsActions) {
    this.actions = actions;
    this.el = document.createElement("div");
    this.el.className = "fb-tabs";
    parent.appendChild(this.el);
    this.render();
  }

  render(): void {
    this.el.innerHTML = "";
    const activeId = this.actions.getActiveTabId();
    const theme = this.actions.getTheme();
    const tabs = this.actions.getTabs();
    tabs.forEach((tab, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fb-tab";
      button.dataset.tabId = tab.id;
      const color = tabColorValue(theme, tab.color);
      button.style.setProperty("--tab-color", color);
      button.style.backgroundColor = color;
      button.classList.toggle("is-active", tab.id === activeId);
      button.draggable = true;
      const icon = document.createElement("span");
      icon.className = "fb-tab__icon";
      setIcon(icon, tab.icon || "bookmark");
      const label = document.createElement("span");
      label.className = "fb-tab__label";
      label.textContent = tab.name;
      button.append(icon, label);
      button.title = `${tab.name} \u00b7 ${tab.pageIds.length} page${tab.pageIds.length === 1 ? "" : "s"}`;
      button.addEventListener("click", () => this.actions.onSelect(tab.id));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.actions.onContextMenu(event, tab);
      });
      button.addEventListener("dblclick", (event) => {
        event.preventDefault();
        this.actions.onContextMenu(event, tab);
      });
      button.addEventListener("dragstart", (event) => {
        this.dragId = tab.id;
        button.classList.add("is-dragging");
        event.dataTransfer?.setData("text/plain", tab.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });
      button.addEventListener("dragend", () => {
        this.dragId = null;
        button.classList.remove("is-dragging");
        this.el.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
      });
      button.addEventListener("dragover", (event) => {
        if (!this.dragId || this.dragId === tab.id) return;
        event.preventDefault();
        button.classList.add("is-drop-target");
      });
      button.addEventListener("dragleave", () => button.classList.remove("is-drop-target"));
      button.addEventListener("drop", (event) => {
        event.preventDefault();
        button.classList.remove("is-drop-target");
        const sourceId = this.dragId ?? event.dataTransfer?.getData("text/plain");
        if (!sourceId || sourceId === tab.id) return;
        const currentIndex = tabs.findIndex((entry) => entry.id === sourceId);
        let targetIndex = index;
        if (currentIndex >= 0 && currentIndex < index) targetIndex = index - 1;
        this.actions.onReorder(sourceId, targetIndex);
      });
      this.el.appendChild(button);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "fb-tab fb-tab--add";
    add.title = "New tab";
    add.setAttribute("aria-label", "New tab");
    const icon = document.createElement("span");
    icon.className = "fb-tab__icon";
    setIcon(icon, "plus");
    add.appendChild(icon);
    add.addEventListener("click", () => this.actions.onAdd());
    this.el.appendChild(add);
  }

  destroy(): void {
    this.el.remove();
  }
}
