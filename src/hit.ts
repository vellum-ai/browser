/**
 * What the page is doing under a point: the CSS cursor, a text caret, a link.
 *
 * The panel draws a JPEG, so page CSS never reaches the user's pointer. This
 * module reads the live DOM at a coordinate and the app applies the result as
 * its own cursor and caret overlay.
 */

import type { Page } from "playwright";

/** CSS cursor keywords the panel will honor. Anything else becomes `default`. */
const CURSOR_KEYWORDS = new Set([
  "auto",
  "default",
  "none",
  "context-menu",
  "help",
  "pointer",
  "progress",
  "wait",
  "cell",
  "crosshair",
  "text",
  "vertical-text",
  "alias",
  "copy",
  "move",
  "no-drop",
  "not-allowed",
  "grab",
  "grabbing",
  "all-scroll",
  "col-resize",
  "row-resize",
  "n-resize",
  "e-resize",
  "s-resize",
  "w-resize",
  "ne-resize",
  "nw-resize",
  "se-resize",
  "sw-resize",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "zoom-in",
  "zoom-out",
]);

export interface Caret {
  x: number;
  y: number;
  height: number;
}

export interface Hit {
  cursor: string;
  caret: Caret | null;
  href: string | null;
}

/**
 * Map a computed `cursor` value to a keyword the panel can set on itself.
 *
 * `url(...) 4 4, pointer` keeps the fallback keyword. Unknown values become
 * `default` so a garbage string cannot break the CSS.
 */
export function normalizeCursor(value: string): string {
  const parts = value.split(",");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const token = (parts[i] ?? "").trim().toLowerCase();
    if (token === "" || token.startsWith("url(")) {
      continue;
    }
    const keyword = token.split(/\s+/)[0] ?? "";
    if (CURSOR_KEYWORDS.has(keyword)) {
      return keyword === "auto" ? "default" : keyword;
    }
  }
  return "default";
}

/** True when `href` is a real http(s) URL the page can navigate to. */
export function isSafeHref(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True when following `href` would load a different document than `beforeUrl`.
 *
 * A hash-only change is the same document. `page.goto` would reload it.
 */
export function isDifferentDocument(href: string, beforeUrl: string): boolean {
  try {
    const next = new URL(href);
    const prev = new URL(beforeUrl);
    return (
      next.origin !== prev.origin ||
      next.pathname !== prev.pathname ||
      next.search !== prev.search
    );
  } catch {
    return false;
  }
}

/**
 * Inspect the page at a CSS-pixel point.
 *
 * `caret` is measured only when asked: the mirror walk is wasted on a hover
 * that only needs the cursor.
 */
export async function hitTest(
  page: Page,
  x: number,
  y: number,
  options: { caret?: boolean } = {},
): Promise<Hit> {
  const wantCaret = options.caret === true;
  try {
    const raw = await page.evaluate(inspectAt, { x, y, wantCaret });
    return {
      cursor: normalizeCursor(typeof raw.cursor === "string" ? raw.cursor : "default"),
      caret: wantCaret ? asCaret(raw.caret) : null,
      href: typeof raw.href === "string" && raw.href !== "" ? raw.href : null,
    };
  } catch {
    return { cursor: "default", caret: null, href: null };
  }
}

function asCaret(value: unknown): Caret | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { x?: unknown; y?: unknown; height?: unknown };
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof record.height !== "number" ||
    !Number.isFinite(record.x) ||
    !Number.isFinite(record.y) ||
    !Number.isFinite(record.height) ||
    record.height <= 0
  ) {
    return null;
  }
  return { x: record.x, y: record.y, height: record.height };
}

/**
 * Runs inside the page. Must stay self-contained: Playwright serializes the
 * function body, and nothing from this module is in scope there.
 */
function inspectAt(input: { x: number; y: number; wantCaret: boolean }): {
  cursor: string;
  caret: { x: number; y: number; height: number } | null;
  href: string | null;
} {
  const node = document.elementFromPoint(input.x, input.y);
  const cursor = node instanceof Element ? getComputedStyle(node).cursor : "default";

  let href: string | null = null;
  if (node instanceof Element) {
    const link = node.closest("a[href]");
    if (link instanceof HTMLAnchorElement && link.href !== "") {
      href = link.href;
    }
  }

  if (!input.wantCaret) {
    return { cursor, caret: null, href };
  }

  const active = document.activeElement;
  let caret: { x: number; y: number; height: number } | null = null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    caret = caretInField(active);
  } else if (active instanceof HTMLElement && active.isContentEditable) {
    caret = caretFromSelection();
  }

  return { cursor, caret, href };

  function caretFromSelection(): { x: number; y: number; height: number } | null {
    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0);
    if (!range.collapsed) {
      return null;
    }
    let rect = range.getBoundingClientRect();
    if (rect.height === 0 && rect.width === 0) {
      const probe = document.createElement("span");
      probe.textContent = "\u200b";
      range.insertNode(probe);
      rect = probe.getBoundingClientRect();
      probe.remove();
    }
    if (rect.height <= 0) {
      return null;
    }
    return { x: rect.left, y: rect.top, height: rect.height };
  }

  function caretInField(
    field: HTMLInputElement | HTMLTextAreaElement,
  ): { x: number; y: number; height: number } | null {
    const type = field instanceof HTMLInputElement ? field.type : "textarea";
    if (
      type === "hidden" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "button" ||
      type === "submit" ||
      type === "reset" ||
      type === "file" ||
      type === "color" ||
      type === "range" ||
      type === "image"
    ) {
      return null;
    }
    if (field.selectionStart === null) {
      return null;
    }

    const style = getComputedStyle(field);
    const box = field.getBoundingClientRect();
    const mirror = document.createElement("div");
    const copied = [
      "boxSizing",
      "width",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "fontVariant",
      "letterSpacing",
      "textTransform",
      "wordSpacing",
      "textIndent",
      "lineHeight",
      "textAlign",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
    ] as const;
    for (const prop of copied) {
      mirror.style[prop] = style[prop];
    }
    mirror.style.position = "absolute";
    mirror.style.left = "0";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.overflow = "hidden";
    mirror.style.whiteSpace = field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
    mirror.style.wordWrap = "break-word";
    mirror.style.height = "auto";

    mirror.textContent = field.value.slice(0, field.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerBox = marker.getBoundingClientRect();
    const mirrorBox = mirror.getBoundingClientRect();
    mirror.remove();

    const x = box.left + (markerBox.left - mirrorBox.left) - field.scrollLeft;
    const y = box.top + (markerBox.top - mirrorBox.top) - field.scrollTop;
    const height =
      Number.parseFloat(style.lineHeight) ||
      markerBox.height ||
      Number.parseFloat(style.fontSize) ||
      16;
    if (x < box.left - 1 || x > box.right + 1 || y + height < box.top || y > box.bottom) {
      return null;
    }
    return { x, y, height };
  }
}
