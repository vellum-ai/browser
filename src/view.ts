/**
 * Capturing "what the page looks like right now" as one payload.
 *
 * Every route that touches the page ends by returning a fresh view, so the app
 * never has to sequence a second request to find out what its click did. A view
 * pairs the capture with the element geometry taken from the same page state,
 * which is what lets the app draw boxes that line up with the image.
 */

import { VIEWPORT, ensurePage } from "./browser.js";
import { collectSnapshot } from "./snapshot.js";
import type { PageElement } from "./snapshot.js";

/** JPEG quality for captures. High enough to read small text, small enough to send. */
const CAPTURE_QUALITY = 80;

/** The payload the app renders after any operation. */
export interface PageView {
  url: string;
  title: string;
  elements: PageElement[];
  /** Base64 JPEG of the page, or null when the capture failed. */
  screenshot: string | null;
  /** Set when the capture failed but the rest of the view is usable. */
  screenshotError: string | null;
  /** True when the capture is the whole scrollable page, not just the viewport. */
  fullPage: boolean;
  /** Size of the capture in CSS pixels, for mapping element boxes onto it. */
  capture: { width: number; height: number };
  /** How far the page is scrolled. */
  scroll: { x: number; y: number };
  /** Short note about what the last operation did, for the app's status line. */
  message: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Capture the current page as a view.
 *
 * The two halves degrade independently. Losing the snapshot is fatal — with no
 * elements there is nothing to interact with. Losing the capture is not: a page
 * mid-navigation or a PDF viewer can refuse a screenshot while the DOM stays
 * perfectly readable, and an element list with a placeholder beats an error.
 */
export async function captureView(
  options: { fullPage?: boolean; message?: string | null } = {},
): Promise<PageView> {
  const page = await ensurePage();
  const fullPage = options.fullPage === true;

  const snapshot = await collectSnapshot(page);

  let screenshot: string | null = null;
  let screenshotError: string | null = null;
  let capture: { width: number; height: number } = {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
  };

  try {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: CAPTURE_QUALITY,
      fullPage,
    });
    screenshot = buffer.toString("base64");

    if (fullPage) {
      // A full-page capture is as tall as the document, so the app needs the
      // real height to scale element boxes against it.
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      capture = { width: VIEWPORT.width, height };
    }
  } catch (err) {
    screenshotError = errorMessage(err);
  }

  // Whether history can move is deliberately not reported here. Playwright
  // does not expose the stack, and `window.history.length` cannot distinguish
  // back from forward and resets on a cross-origin navigation — a button
  // greyed out on that basis would be wrong as often as it was right. Instead
  // the buttons stay enabled and the act route says "No page to go back to"
  // when Playwright reports the move did not happen.
  return {
    url: snapshot.url,
    title: snapshot.title,
    elements: snapshot.elements,
    screenshot,
    screenshotError,
    fullPage,
    capture,
    scroll: snapshot.scroll,
    message: options.message ?? null,
  };
}
