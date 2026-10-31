import { setIcon } from "obsidian";

export interface PopoverOptions {
  align?: "left" | "right" | "center";
  width?: number;
  className?: string;
}

export interface PopoverHandle {
  el: HTMLElement;
  close: () => void;
  refreshPosition: () => void;
}

let activeClose: (() => void) | null = null;

/** Closes the open popover, if any, and releases its document-level listeners. */
export function closeAllPopovers(): void {
  activeClose?.();
}

export function openPopover(
  anchor: HTMLElement,
  build: (host: HTMLElement, close: () => void) => void,
  options: PopoverOptions = {},
): PopoverHandle {
  closeAllPopovers();
  const el = document.createElement("div");
  el.className = `fb-popover${options.className ? ` ${options.className}` : ""}`;
  if (options.width) el.style.width = `${options.width}px`;
  document.body.appendChild(el);
  const close = () => {
    el.remove();
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", refreshPosition);
    window.removeEventListener("scroll", refreshPosition, true);
    if (activeClose === close) activeClose = null;
  };
  const outside = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target && (el.contains(target) || anchor.contains(target))) return;
    close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  const refreshPosition = () => {
    const rect = anchor.getBoundingClientRect();
    const popRect = el.getBoundingClientRect();
    const align = options.align ?? "left";
    let left = rect.left;
    if (align === "right") left = rect.right - popRect.width;
    else if (align === "center") left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(10, Math.min(window.innerWidth - popRect.width - 10, left));
    let top = rect.bottom + 8;
    if (top + popRect.height > window.innerHeight - 10) top = Math.max(10, rect.top - popRect.height - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  build(el, close);
  requestAnimationFrame(refreshPosition);
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", refreshPosition);
  window.addEventListener("scroll", refreshPosition, true);
  activeClose = close;
  return { el, close, refreshPosition };
}

export function popoverItem(
  host: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
  detail?: string,
): HTMLElement {
  const button = document.createElement("button");
  button.className = "fb-popover__item";
  button.type = "button";
  const iconEl = document.createElement("span");
  iconEl.className = "fb-popover__icon";
  setIcon(iconEl, icon);
  const text = document.createElement("span");
  text.className = "fb-popover__text";
  text.textContent = label;
  button.append(iconEl, text);
  if (detail) {
    const hint = document.createElement("span");
    hint.className = "fb-popover__detail";
    hint.textContent = detail;
    button.appendChild(hint);
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  host.appendChild(button);
  return button;
}

export function popoverHeading(host: HTMLElement, text: string): HTMLElement {
  const heading = document.createElement("div");
  heading.className = "fb-popover__heading";
  heading.textContent = text;
  host.appendChild(heading);
  return heading;
}

export function popoverDivider(host: HTMLElement): HTMLElement {
  const divider = document.createElement("div");
  divider.className = "fb-popover__divider";
  host.appendChild(divider);
  return divider;
}
