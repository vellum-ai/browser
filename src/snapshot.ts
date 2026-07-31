/**
 * Reading the page's interactive elements, and addressing them afterwards.
 *
 * The app needs two things from every element: enough to describe it in a list,
 * and enough to draw a box over it on the capture. So the collector runs in the
 * page, tags each element it finds with a `data-vellum-eid` attribute, and
 * returns the geometry alongside the description.
 *
 * Tagging is what makes the id durable. An index into a list goes stale the
 * moment the DOM shifts; an attribute on the node itself survives re-layout,
 * and a click on it either hits the element it named or fails loudly because
 * the node is gone. {@link elementLocator} is the only way this plugin reaches
 * an element, so there is no path where an id silently resolves to a different
 * node than the one the user was looking at.
 *
 * Everything the collector returns is page-authored — names, attribute values,
 * the URL in an `href`. It is data, rendered as text and used to build
 * arguments; nothing here or in the app treats it as instructions.
 */

import type { Page } from "playwright";

import { BrowserError } from "./browser.js";

/** The attribute the collector stamps on every element it reports. */
const EID_ATTRIBUTE = "data-vellum-eid";

/** A rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One interactive element on the page. */
export interface PageElement {
  /** Stable handle for this element, valid until the next collection. */
  eid: string;
  /** ARIA role, explicit or derived from the tag. */
  role: string;
  /** Accessible name. */
  name: string;
  /** The few attributes worth showing or acting on. */
  attrs: Record<string, string>;
  /** Current value, for elements that carry one. */
  value?: string;
  /** Position relative to the viewport — where to draw a box on a capture. */
  rect: Rect;
  /** Position relative to the document — the same, for a full-page capture. */
  pageRect: Rect;
}

/** What a collection reports about the page as a whole. */
export interface PageSnapshot {
  url: string;
  title: string;
  elements: PageElement[];
  /** How far the page is scrolled, so the app can map a capture to the page. */
  scroll: { x: number; y: number };
}

/**
 * Collect the page's interactive elements.
 *
 * Runs as a single `page.evaluate`, so the body below executes in the page and
 * must stay self-contained — no imports, no closure over anything out here.
 */
export async function collectSnapshot(page: Page): Promise<PageSnapshot> {
  const result = await page.evaluate((attribute: string) => {
    const SELECTOR = [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      "[contenteditable=''], [contenteditable='true']",
      "[role=button]",
      "[role=link]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=switch]",
      "[role=tab]",
      "[role=menuitem]",
      "[role=menuitemcheckbox]",
      "[role=menuitemradio]",
      "[role=option]",
      "[role=combobox]",
      "[role=searchbox]",
      "[role=textbox]",
      "[role=slider]",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");

    /** Tag-to-role mapping for elements with no explicit `role`. */
    const roleForTag = (element: Element): string => {
      const tag = element.tagName.toLowerCase();
      if (tag === "a") {
        return "link";
      }
      if (tag === "button" || tag === "summary") {
        return "button";
      }
      if (tag === "select") {
        return (element as HTMLSelectElement).multiple ? "listbox" : "combobox";
      }
      if (tag === "textarea") {
        return "textbox";
      }
      if (tag === "input") {
        const type = ((element as HTMLInputElement).type || "text").toLowerCase();
        if (type === "checkbox" || type === "radio") {
          return type;
        }
        if (type === "button" || type === "submit" || type === "reset") {
          return "button";
        }
        if (type === "search") {
          return "searchbox";
        }
        if (type === "range") {
          return "slider";
        }
        if (type === "number") {
          return "spinbutton";
        }
        return "textbox";
      }
      return tag;
    };

    /**
     * The element's accessible name, in roughly the order a screen reader
     * would resolve it. Visible text wins for a control that has some, since
     * that is what the person looking at the page would call it.
     */
    const nameFor = (element: Element): string => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy !== null) {
        const named = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (named !== "") {
          return named;
        }
      }

      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel !== null && ariaLabel.trim() !== "") {
        return ariaLabel.trim();
      }

      // A form control's <label> is its name. Checking this before the text
      // below also keeps a labelled control from being named after its own
      // contents.
      const labels = (element as { labels?: NodeListOf<HTMLLabelElement> }).labels;
      const labelText = labels?.[0]?.textContent?.trim();
      if (labelText !== undefined && labelText !== "") {
        return labelText;
      }

      // A <select>'s text is the concatenation of every option, which reads as
      // "United States France" rather than as a name. Its current selection is
      // reported separately, as the element's value.
      if (!(element instanceof HTMLSelectElement)) {
        const text = (element as HTMLElement).innerText?.trim() ?? "";
        if (text !== "") {
          return text;
        }
      }

      for (const attribute of ["title", "placeholder", "alt", "name"]) {
        const value = element.getAttribute(attribute);
        if (value !== null && value.trim() !== "") {
          return value.trim();
        }
      }

      if (element instanceof HTMLInputElement && element.value !== "") {
        return element.value;
      }
      return "";
    };

    const nodes = Array.from(document.querySelectorAll(SELECTOR));
    const elements = [];
    let counter = 0;

    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      // Zero-area nodes are laid out but not on screen — a collapsed menu, a
      // visually-hidden skip link. They cannot be pointed at, so they are not
      // offered.
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      const style = window.getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
        continue;
      }

      counter += 1;
      const eid = `e${counter}`;
      node.setAttribute(attribute, eid);

      const attrs: Record<string, string> = {};
      for (const key of ["href", "type", "placeholder", "title", "name"]) {
        const value = node.getAttribute(key);
        if (value !== null && value !== "") {
          attrs[key] = value.slice(0, 300);
        }
      }
      if (node instanceof HTMLInputElement) {
        if (node.checked) {
          attrs.checked = "true";
        }
        if (node.disabled) {
          attrs.disabled = "true";
        }
      }
      const expanded = node.getAttribute("aria-expanded");
      if (expanded !== null) {
        attrs.expanded = expanded;
      }

      const value =
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement
          ? node.value
          : undefined;

      elements.push({
        eid,
        role: node.getAttribute("role")?.trim() || roleForTag(node),
        name: nameFor(node).slice(0, 300),
        attrs,
        ...(value === undefined || value === "" ? {} : { value: value.slice(0, 300) }),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        pageRect: {
          x: Math.round(rect.x + window.scrollX),
          y: Math.round(rect.y + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }

    return {
      url: document.location.href,
      title: document.title,
      elements,
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    };
  }, EID_ATTRIBUTE);

  return result as PageSnapshot;
}

/**
 * A locator for a previously collected element.
 *
 * Ids are only meaningful for the collection that produced them, so a request
 * carrying one from an older collection resolves to nothing and fails with a
 * message saying so — rather than acting on whichever node inherited the id.
 */
export function elementLocator(page: Page, eid: string) {
  if (!/^e\d+$/.test(eid)) {
    throw new BrowserError(`\`${eid}\` is not an element id.`, { status: 400 });
  }
  return page.locator(`[${EID_ATTRIBUTE}="${eid}"]`);
}

/**
 * Extract the page's visible text, and optionally its links.
 *
 * `innerText` rather than `textContent`: it respects layout, so it skips hidden
 * nodes and preserves the line breaks that make the result readable instead of
 * one run-on paragraph.
 */
export async function extractText(
  page: Page,
  includeLinks: boolean,
): Promise<{ text: string; url: string }> {
  return page.evaluate((withLinks: boolean) => {
    const body = document.body?.innerText?.trim() ?? "";
    if (!withLinks) {
      return { text: body, url: document.location.href };
    }

    const links = Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 200)
      .map((anchor) => {
        const label = (anchor as HTMLElement).innerText.trim().slice(0, 120);
        const href = anchor.getAttribute("href") ?? "";
        return `  [${label === "" ? "(no text)" : label}](${href.slice(0, 300)})`;
      });

    return {
      text: links.length === 0 ? body : `${body}\n\nLinks:\n${links.join("\n")}`,
      url: document.location.href,
    };
  }, includeLinks);
}
