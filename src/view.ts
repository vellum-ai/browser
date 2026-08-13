/**
 * The page's identity: URL, title, and an optional note.
 *
 * The live picture of the page is a separate stream (`src/screencast.ts`).
 * Routes that navigate or go back/forward/reload answer with this so the
 * address bar can update without waiting on a screenshot.
 */

import type { Page } from "playwright";

export interface PageIdentity {
  url: string;
  title: string;
  message: string | null;
}

export async function pageIdentity(
  page: Page,
  message: string | null = null,
): Promise<PageIdentity> {
  let title = "";
  try {
    title = await page.title();
  } catch {
    title = "";
  }
  return { url: page.url(), title, message };
}
