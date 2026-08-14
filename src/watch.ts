/**
 * Keep the live picture attached across navigations, and finish a click that
 * the page did not follow on its own.
 *
 * A CDP screencast dies when the main frame navigates. Restarting it is what
 * makes the next page appear instead of the last JPEG of the previous one.
 * Popups (`target="_blank"`) have nowhere to go in a single-viewport app, so
 * their URL is loaded in the page the user is already looking at.
 */

import type { Page } from "playwright";

import { isDifferentDocument, isSafeHref } from "./hit.js";
import { startScreencast, stopScreencast } from "./screencast.js";

const hooked = new WeakSet<Page>();

let restarting: Promise<void> | null = null;

/** Tear the stream down and start it again, keeping the last JPEG up. */
export async function restartScreencast(page: Page): Promise<void> {
  if (restarting !== null) {
    await restarting;
  }
  restarting = (async () => {
    await stopScreencast({ keepFrame: true });
    await startScreencast(page);
  })().finally(() => {
    restarting = null;
  });
  await restarting;
}

/**
 * Attach navigation and popup handlers once per page.
 *
 * Safe to call on every input: a page already watched is a no-op.
 */
export function watchPage(page: Page): void {
  if (hooked.has(page)) {
    return;
  }
  hooked.add(page);

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      void restartScreencast(page);
    }
  });

  page.on("popup", (popup) => {
    void adoptPopup(page, popup);
  });
}

/**
 * If a click named an http(s) link and the page URL did not change, go there.
 *
 * Playwright's mouse events are the first attempt. Sites that swallow the
 * click, or a coordinate that landed on padding around the `<a>`, still have
 * the href from the hit-test, and that is enough to navigate.
 */
export async function followHref(page: Page, href: string | null, beforeUrl: string): Promise<void> {
  if (href === null || !isSafeHref(href)) {
    return;
  }
  if (page.url() !== beforeUrl) {
    return;
  }
  if (!isDifferentDocument(href, beforeUrl)) {
    return;
  }

  try {
    await page.evaluate((target) => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      const match = links.find((node) => node instanceof HTMLAnchorElement && node.href === target);
      if (match instanceof HTMLAnchorElement) {
        match.click();
      }
    }, href);
  } catch {
    // The document may already be unloading.
  }
  if (page.url() !== beforeUrl) {
    return;
  }

  try {
    await page.goto(href, { waitUntil: "commit", timeout: 30_000 });
  } catch {
    // The page may have started navigating on its own.
  }
}

async function adoptPopup(opener: Page, popup: Page): Promise<void> {
  const deadline = Date.now() + 8_000;
  let url = popup.url();
  while ((url === "" || url === "about:blank") && Date.now() < deadline) {
    try {
      await popup.waitForLoadState("domcontentloaded", { timeout: 500 });
    } catch {
      // Still blank; try again until the deadline.
    }
    url = popup.url();
    if (url === "" || url === "about:blank") {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }
  try {
    await popup.close();
  } catch {
    // Already gone.
  }
  if (!isSafeHref(url)) {
    return;
  }
  try {
    await opener.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    // The opener may have navigated itself.
  }
}
