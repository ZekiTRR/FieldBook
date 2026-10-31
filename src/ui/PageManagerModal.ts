import { App, Menu, Modal, Notice } from "obsidian";
import type { JournalManager } from "../core/JournalManager";
import type { PageBackground, TabColor } from "../types";
import { TAB_COLOR_OPTIONS } from "../types";
import { ConfirmModal, PromptModal } from "./BasicModals";

export interface PageManagerHost {
  store: JournalManager;
  getCurrentPageId: () => string | null;
  navigateToPage: (pageId: string) => void;
  onDestructiveDelete: () => void;
}

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

export class PageManagerModal extends Modal {
  private readonly host: PageManagerHost;

  constructor(app: App, host: PageManagerHost) {
    super(app);
    this.host = host;
    this.modalEl.addClass("fb-modal-shell", "fb-manager-modal");
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fb-modal");
    titleEl.setText("Notebook map");
    const store = this.host.store;

    const top = contentEl.createDiv({ cls: "fb-manager__top" });
    const addTab = top.createEl("button", { cls: "fb-button", text: "New tab" });
    addTab.addEventListener("click", () => this.promptNewTab());
    const addContents = top.createEl("button", { cls: "fb-button", text: "Contents page" });
    addContents.addEventListener("click", () => {
      void store.createContentsPage().then(() => this.render());
    });
    const trash = top.createEl("button", {
      cls: "fb-button",
      text: `Trash (${store.getTrash().length})`,
    });
    trash.addEventListener("click", () => {
      new TrashModal(this.app, store, () => this.render()).open();
    });

    const list = contentEl.createDiv({ cls: "fb-manager__list" });
    for (const tab of store.getTabs()) {
      const block = list.createDiv({ cls: "fb-manager__tab" });
      const head = block.createDiv({ cls: "fb-manager__tab-head" });
      const name = head.createSpan({ cls: "fb-manager__tab-name", text: tab.name });
      name.style.setProperty("--tab-color", "transparent");
      const count = head.createSpan({
        cls: "fb-manager__count",
        text: `${tab.pageIds.length} page${tab.pageIds.length === 1 ? "" : "s"}`,
      });
      const spacer = head.createSpan({ cls: "fb-manager__spacer" });
      const addPage = head.createEl("button", { cls: "fb-icon-button", attr: { "aria-label": "Add page" } });
      addPage.setText("+");
      addPage.addEventListener("click", () => {
        void store.createPage(tab.id).then((page) => {
          if (page) {
            this.host.navigateToPage(page.id);
            this.close();
          }
        });
      });
      const more = head.createEl("button", { cls: "fb-icon-button", text: "\u22ef", attr: { "aria-label": "Tab actions" } });
      more.addEventListener("click", (event) => this.openTabMenu(event, tab.id));
      head.append(name, count, spacer, addPage, more);

      tab.pageIds.forEach((pageId, index) => {
        const meta = store.getPageMeta(pageId);
        if (!meta) return;
        const row = block.createDiv({ cls: "fb-manager__row" });
        if (pageId === this.host.getCurrentPageId()) row.addClass("is-current");
        const number = row.createSpan({
          cls: "fb-manager__number",
          text: String(store.getPageNumber(pageId) || "\u00b7"),
        });
        const label = row.createDiv({ cls: "fb-manager__page-label" });
        const title = label.createSpan({ cls: "fb-manager__page-title", text: meta.title });
        const sub = label.createSpan({
          cls: "fb-manager__page-sub",
          text: meta.kind === "contents" ? "Auto contents" : backgroundLabel(meta.background),
        });
        title.addEventListener("click", () => {
          this.host.navigateToPage(pageId);
          this.close();
        });
        sub.addEventListener("click", () => {
          this.host.navigateToPage(pageId);
          this.close();
        });
        const actions = row.createDiv({ cls: "fb-manager__row-actions" });
        const up = actions.createEl("button", { cls: "fb-icon-button", text: "\u2191", attr: { "aria-label": "Move up" } });
        up.disabled = index === 0;
        up.addEventListener("click", () => {
          store.reorderPage(tab.id, index, -1);
          this.render();
        });
        const down = actions.createEl("button", { cls: "fb-icon-button", text: "\u2193", attr: { "aria-label": "Move down" } });
        down.disabled = index === tab.pageIds.length - 1;
        down.addEventListener("click", () => {
          store.reorderPage(tab.id, index, 1);
          this.render();
        });
        const menu = actions.createEl("button", { cls: "fb-icon-button", text: "\u22ef", attr: { "aria-label": "Page actions" } });
        menu.addEventListener("click", (event) => this.openPageMenu(event, pageId));
        row.append(number, label, actions);
      });

      if (!tab.pageIds.length) {
        block.createDiv({ cls: "fb-manager__empty", text: "No pages in this tab yet." });
      }
    }

    const foot = contentEl.createDiv({ cls: "fb-manager__foot" });
    foot.setText(`${store.getPageCount()} pages \u00b7 ${store.getTabs().length} tabs`);
  }

  private promptNewTab(): void {
    new PromptModal(this.app, {
      title: "New tab",
      label: "Tab name",
      placeholder: "Field notes",
      onSubmit: (name) => {
        const tab = this.host.store.addTab(name || "New tab");
        window.setTimeout(() => {
          this.host.navigateToPage(this.host.store.getTab(tab.id)?.pageIds[0] ?? "");
        }, 80);
        this.close();
      },
    }).open();
  }

  private openPageMenu(event: MouseEvent, pageId: string): void {
    const store = this.host.store;
    const meta = store.getPageMeta(pageId);
    if (!meta) return;
    const tab = store.getTab(meta.tabId);
    const index = tab ? tab.pageIds.indexOf(pageId) : 0;
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Rename").setIcon("pencil").onClick(() => {
        new PromptModal(this.app, {
          title: "Rename page",
          value: meta.title,
          onSubmit: (value) => {
            store.renamePage(pageId, value);
            this.render();
          },
        }).open();
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Duplicate").setIcon("copy-plus").onClick(() => {
        void store.duplicatePage(pageId).then(() => this.render());
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Move to tab").setIcon("folder-input").onClick(() => {
        const moveMenu = new Menu();
        const targets = store.getTabs().filter((other) => other.id !== meta.tabId);
        for (const other of targets) {
          moveMenu.addItem((sub) =>
            sub.setTitle(other.name).onClick(() => {
              store.movePage(pageId, other.id, other.pageIds.length);
              this.render();
            }),
          );
        }
        if (!targets.length) new Notice("Fieldbook: there is only one tab.");
        else moveMenu.showAtMouseEvent(event);
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Background").setIcon("layout-template").onClick(() => {
        const bgMenu = new Menu();
        const backgrounds: PageBackground[] = ["plain", "ruled", "grid", "dots"];
        for (const bg of backgrounds) {
          bgMenu.addItem((sub) =>
            sub.setTitle(backgroundLabel(bg)).setChecked(meta.background === bg).onClick(() => {
              store.setPageBackground(pageId, bg);
              this.render();
            }),
          );
        }
        bgMenu.showAtMouseEvent(event);
      }),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Delete page")
        .setIcon("trash")
        .onClick(() => {
          new ConfirmModal(this.app, {
            title: "Move page to trash?",
            message: `"${meta.title}" will be moved to the notebook trash. You can restore it later.`,
            cta: "Move to trash",
            destructive: true,
            onConfirm: () => {
              void store.deletePage(pageId).then(() => {
                this.host.onDestructiveDelete();
                this.render();
              });
            },
          }).open();
        }),
    );
    menu.addItem((item) =>
      item.setTitle("Move up").setIcon("arrow-up").setDisabled(index === 0).onClick(() => {
        store.reorderPage(meta.tabId, index, -1);
        this.render();
      }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move down")
        .setIcon("arrow-down")
        .setDisabled(!tab || index === tab.pageIds.length - 1)
        .onClick(() => {
          store.reorderPage(meta.tabId, index, 1);
          this.render();
        }),
    );
    menu.showAtMouseEvent(event);
  }

  private openTabMenu(event: MouseEvent, tabId: string): void {
    const store = this.host.store;
    const tab = store.getTab(tabId);
    if (!tab) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("Rename tab").setIcon("pencil").onClick(() => {
        new PromptModal(this.app, {
          title: "Rename tab",
          value: tab.name,
          onSubmit: (value) => {
            store.renameTab(tabId, value);
            this.render();
          },
        }).open();
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Tab colour").setIcon("palette").onClick(() => {
        const colorMenu = new Menu();
        for (const color of TAB_COLOR_OPTIONS) {
          colorMenu.addItem((sub) =>
            sub
              .setTitle(colorLabel(color))
              .setChecked(tab.color === color)
              .onClick(() => {
                store.setTabColor(tabId, color);
                this.render();
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
              store.setTabIcon(tabId, icon);
              this.render();
            }),
          );
        }
        iconMenu.showAtMouseEvent(event);
      }),
    );
    menu.addItem((item) =>
      item.setTitle("Add page").setIcon("file-plus").onClick(() => {
        void store.createPage(tabId).then(() => this.render());
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
            void store.deleteTab(tabId).then(() => {
              this.host.onDestructiveDelete();
              this.render();
            });
          },
        }).open();
      }),
    );
    menu.showAtMouseEvent(event);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class TrashModal extends Modal {
  private readonly store: JournalManager;
  private readonly onChange: () => void;

  constructor(app: App, store: JournalManager, onChange: () => void) {
    super(app);
    this.store = store;
    this.onChange = onChange;
    this.modalEl.addClass("fb-modal-shell", "fb-manager-modal");
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    contentEl.addClass("fb-modal");
    titleEl.setText("Notebook trash");
    const entries = this.store.getTrash();
    if (!entries.length) {
      contentEl.createEl("p", { cls: "fb-modal__message", text: "Trash is empty." });
    }
    const list = contentEl.createDiv({ cls: "fb-manager__list" });
    entries.forEach((entry, index) => {
      const row = list.createDiv({ cls: "fb-manager__row" });
      row.createSpan({ cls: "fb-manager__number", text: "\u2020" });
      const label = row.createDiv({ cls: "fb-manager__page-label" });
      label.createSpan({ cls: "fb-manager__page-title", text: entry.meta.title });
      label.createSpan({
        cls: "fb-manager__page-sub",
        text: `deleted ${new Date(entry.deletedAt).toLocaleDateString()}`,
      });
      const actions = row.createDiv({ cls: "fb-manager__row-actions" });
      const restore = actions.createEl("button", { cls: "fb-button fb-button--small", text: "Restore" });
      restore.addEventListener("click", () => {
        void this.store.restorePage(index).then(() => {
          this.render();
          this.onChange();
        });
      });
      const purge = actions.createEl("button", { cls: "fb-icon-button", text: "\u2715", attr: { "aria-label": "Delete permanently" } });
      purge.addEventListener("click", () => {
        new ConfirmModal(this.app, {
          title: "Delete permanently?",
          message: `"${entry.meta.title}" will be removed from disk. This cannot be undone.`,
          cta: "Delete forever",
          destructive: true,
          onConfirm: () => {
            void this.store.permanentlyDeleteTrash(index).then(() => this.render());
          },
        }).open();
      });
      row.append(label, actions);
    });
    const buttons = contentEl.createDiv({ cls: "fb-modal__buttons" });
    if (entries.length) {
      const empty = buttons.createEl("button", { text: "Empty trash", cls: "fb-button fb-button--danger" });
      empty.addEventListener("click", () => {
        new ConfirmModal(this.app, {
          title: "Empty the trash?",
          message: "All deleted page files will be removed from disk. This cannot be undone.",
          cta: "Empty trash",
          destructive: true,
          onConfirm: () => {
            void this.store.emptyTrash().then(() => this.render());
          },
        }).open();
      });
    }
    const close = buttons.createEl("button", { text: "Close", cls: "fb-button" });
    close.addEventListener("click", () => {
      this.close();
      this.onChange();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.onChange();
  }
}

function backgroundLabel(background: PageBackground): string {
  switch (background) {
    case "ruled":
      return "Ruled lines";
    case "grid":
      return "Square grid";
    case "dots":
      return "Dot grid";
    default:
      return "Plain paper";
  }
}

function colorLabel(color: TabColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}
