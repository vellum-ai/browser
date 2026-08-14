/**
 * `GET /x/plugins/browser/frame`: the latest live picture of the page.
 *
 * The app long-polls this while the browser is up. A `?since=` of the last
 * sequence the canvas painted means this route can sit until Chromium
 * composites a new JPEG, and answer without a screenshot when nothing has
 * changed. It never launches, never collects elements, and never takes a
 * fresh screenshot when the screencast already has a frame.
 */

import { isRunning } from "../src/browser.js";
import { waitForFrame } from "../src/frame-wait.js";
import { handle, ok } from "../src/http.js";
import { currentViewport, latestFrame, startScreencast } from "../src/screencast.js";
import { activeTabId, ensurePage } from "../src/session.js";

export interface FrameBody {
  screenshot: string | null;
  width: number;
  height: number;
  url: string;
  title: string;
  seq: number;
  tabId: string;
}

/** One first-paint screenshot, not one per poll. A poll that screenshots is the old lag. */
let firstPaintTaken = false;
let paintedTabId = "";
let cachedTitle = "";
let cachedTitleAt = 0;
let cachedTitleUrl = "";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    if (!isRunning()) {
      firstPaintTaken = false;
      paintedTabId = "";
      cachedTitle = "";
      cachedTitleUrl = "";
      const empty: FrameBody = {
        screenshot: null,
        width: currentViewport().width,
        height: currentViewport().height,
        url: "",
        title: "",
        seq: 0,
        tabId: "",
      };
      return ok(empty);
    }

    const page = await ensurePage();
    const tabId = activeTabId();
    if (tabId !== paintedTabId) {
      firstPaintTaken = false;
      paintedTabId = tabId;
      cachedTitle = "";
      cachedTitleUrl = "";
    }
    await startScreencast(page);

    const since = sinceOf(request);
    const frame = await waitForFrame(since);
    const size = currentViewport();

    if (frame !== null && frame.seq > since) {
      // Width/height are the Playwright viewport, not the JPEG or CDP
      // deviceWidth. Clicks are dispatched in that space; a stale 1280x800
      // frame size on a 400px panel is how most clicks missed the page.
      return ok(await bodyOf(page, frame.jpeg, size.width, size.height, frame.seq));
    }

    if (frame !== null) {
      return ok(await bodyOf(page, null, size.width, size.height, frame.seq));
    }

    // First paint only: the stream has not produced a frame yet. Later empty
    // polls wait for the stream instead of taking another still.
    if (!firstPaintTaken) {
      firstPaintTaken = true;
      try {
        const buffer = await page.screenshot({ type: "jpeg", quality: 55 });
        return ok(await bodyOf(page, buffer.toString("base64"), size.width, size.height, 0));
      } catch {
        // Fall through to an empty frame; the next poll retries the stream.
      }
    }

    return ok(await bodyOf(page, null, size.width, size.height, latestFrame()?.seq ?? 0));
  });
}

function sinceOf(request: Request): number {
  const raw = new URL(request.url).searchParams.get("since");
  if (raw === null || raw === "") {
    return 0;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

async function bodyOf(
  page: import("playwright").Page,
  screenshot: string | null,
  width: number,
  height: number,
  seq: number,
): Promise<FrameBody> {
  return {
    screenshot,
    width,
    height,
    url: page.url(),
    title: await titleOf(page),
    seq,
    tabId: activeTabId(),
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
