/**
 * Capturing "what the page looks like right now" as one payload.
 *
 * Every route that changes the page ends by returning a fresh view, so the app
 * never has to sequence a second request to find out what its click did. A view
 * is a snapshot (the interactive elements, addressable by id) plus a screenshot
 * (what the user sees), which are two separate operations against the same
 * page.
 */

import { runBrowserOperation } from "./assistant-cli.js";
import type { CliScreenshot } from "./assistant-cli.js";
import type { BrowserAppConfig } from "./config.js";
import { parseSnapshot } from "./page.js";
import type { PageElement } from "./page.js";

/** The payload the app renders after any operation. */
export interface PageView {
  url: string;
  title: string;
  elements: PageElement[];
  screenshot: CliScreenshot | null;
  /** Set when the screenshot failed but the rest of the view is usable. */
  screenshotError: string | null;
  /** Short note about what the last operation did, for the app's status line. */
  message: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Capture the current page as a view.
 *
 * The two operations degrade independently. A snapshot failure is fatal — with
 * no element list there is nothing to interact with, so the error propagates.
 * A screenshot failure is not: some backends and some pages (a PDF viewer, a
 * page mid-navigation) refuse a capture while the accessibility tree is still
 * perfectly readable, and an element list with a placeholder beats an error
 * page.
 */
export async function captureView(
  config: BrowserAppConfig,
  options: { fullPage?: boolean; message?: string | null } = {},
): Promise<PageView> {
  const snapshotResult = await runBrowserOperation("snapshot", {}, config);
  const snapshot = parseSnapshot(snapshotResult.content);

  let screenshot: CliScreenshot | null = null;
  let screenshotError: string | null = null;
  try {
    const shot = await runBrowserOperation(
      "screenshot",
      options.fullPage === true ? { full_page: true } : {},
      config,
    );
    screenshot = shot.screenshots[0] ?? null;
    if (screenshot === null) {
      screenshotError = "The browser returned no image for this page.";
    }
  } catch (err) {
    screenshotError = errorMessage(err);
  }

  return {
    url: snapshot.url,
    title: snapshot.title,
    elements: snapshot.elements,
    screenshot,
    screenshotError,
    message: options.message ?? null,
  };
}
