/**
 * `GET /x/plugins/browser/frame`: the latest live picture of the page.
 *
 * The app polls this while the browser is up. It never launches, never
 * collects elements, and never takes a fresh screenshot when the screencast
 * already has a frame: those are what made scrolling feel like paging through
 * stills.
 */

import { ensurePage, isRunning } from "../src/browser.js";
import { handle, ok } from "../src/http.js";
import { currentViewport, latestFrame, startScreencast } from "../src/screencast.js";

export interface FrameBody {
  screenshot: string | null;
  width: number;
  height: number;
  url: string;
  title: string;
}

/** One first-paint screenshot, not one per poll. A poll that screenshots is the old lag. */
let firstPaintTaken = false;
let cachedTitle = "";
let cachedTitleAt = 0;
let cachedTitleUrl = "";

export async function GET(): Promise<Response> {
  return handle(async () => {
    if (!isRunning()) {
      firstPaintTaken = false;
      cachedTitle = "";
      cachedTitleUrl = "";
      const empty: FrameBody = {
        screenshot: null,
        width: currentViewport().width,
        height: currentViewport().height,
        url: "",
        title: "",
      };
      return ok(empty);
    }

    const page = await ensurePage();
    await startScreencast(page);

    const frame = latestFrame();
    if (frame !== null) {
      return ok(await bodyOf(page, frame.jpeg, frame.width, frame.height));
    }

    // First paint only: the stream has not produced a frame yet. Later empty
    // polls wait for the stream instead of taking another still.
    if (!firstPaintTaken) {
      firstPaintTaken = true;
      try {
        const buffer = await page.screenshot({ type: "jpeg", quality: 55 });
        const size = currentViewport();
        return ok(await bodyOf(page, buffer.toString("base64"), size.width, size.height));
      } catch {
        // Fall through to an empty frame; the next poll retries the stream.
      }
    }

    const size = currentViewport();
    return ok(await bodyOf(page, null, size.width, size.height));
  });
}

async function bodyOf(
  page: import("playwright").Page,
  screenshot: string | null,
  width: number,
  height: number,
): Promise<FrameBody> {
  return {
    screenshot,
    width,
    height,
    url: page.url(),
    title: await titleOf(page),
  };
}

async function titleOf(page: import("playwright").Page): Promise<string> {
  const url = page.url();
  const now = Date.now();
  if (url === cachedTitleUrl && now - cachedTitleAt < 1000) {
    return cachedTitle;
  }
  try {
    cachedTitle = await page.title();
    cachedTitleAt = now;
    cachedTitleUrl = url;
    return cachedTitle;
  } catch {
    return cachedTitle;
  }
}
