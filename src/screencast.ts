/**
 * A live picture of the page, as a stream of JPEG frames.
 *
 * The app cannot embed Chromium and cannot iframe most sites (they send
 * X-Frame-Options). The panel therefore shows this stream and forwards pointer,
 * wheel, and keyboard events to the real page. That is what makes scrolling
 * happen in the page rather than across a still screenshot.
 */

import type { CDPSession, Page } from "playwright";

/** Size used until the app reports the panel's own dimensions. */
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

export interface Frame {
  jpeg: string;
  width: number;
  height: number;
}

let session: CDPSession | null = null;
let attached: Page | null = null;
let latest: Frame | null = null;
let attaching: Promise<void> | null = null;
let viewport: { width: number; height: number } = {
  width: DEFAULT_VIEWPORT.width,
  height: DEFAULT_VIEWPORT.height,
};

/** The most recent frame, or null if none has arrived yet. */
export function latestFrame(): Frame | null {
  return latest;
}

/** The size the page is currently rendering at. */
export function currentViewport(): { width: number; height: number } {
  return { ...viewport };
}

/**
 * Begin streaming frames from this page.
 *
 * Idempotent for the same page. A different page (the previous one closed)
 * tears the old session down first. Failures are swallowed by the caller: a
 * missing stream falls back to a one-shot screenshot on `/frame`.
 */
export async function startScreencast(page: Page): Promise<void> {
  if (attached === page && session !== null) {
    return;
  }
  if (attaching !== null) {
    await attaching;
    if (attached === page && session !== null) {
      return;
    }
  }
  attaching = attach(page).finally(() => {
    attaching = null;
  });
  await attaching;
}

async function attach(page: Page): Promise<void> {
  await stopScreencast({ keepFrame: true });
  const next = await page.context().newCDPSession(page);
  next.on("Page.screencastFrame", (event: ScreencastEvent) => {
    latest = {
      jpeg: event.data,
      width: event.metadata?.deviceWidth ?? viewport.width,
      height: event.metadata?.deviceHeight ?? viewport.height,
    };
    void next.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {
      // The session ended between the frame and the ack.
    });
  });
  await next.send("Page.startScreencast", {
    format: "jpeg",
    quality: 55,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
  session = next;
  attached = page;
  page.once("close", () => {
    if (attached === page) {
      void stopScreencast();
    }
  });
}

/** Stop the stream. Safe to call when nothing is up. */
export async function stopScreencast(options: { keepFrame?: boolean } = {}): Promise<void> {
  const open = session;
  session = null;
  attached = null;
  if (options.keepFrame !== true) {
    latest = null;
  }
  if (open === null) {
    return;
  }
  try {
    await open.send("Page.stopScreencast");
  } catch {
    // Already gone.
  }
  try {
    await open.detach();
  } catch {
    // Already gone.
  }
}

/**
 * Match the page to the panel.
 *
 * The stream is sized to this viewport, so the image can fill the panel
 * without letterboxing or showing a slice of a larger capture. A no-op when
 * the size has not moved far enough to be worth a restart.
 */
export async function resizeViewport(
  page: Page,
  width: number,
  height: number,
): Promise<{ width: number; height: number }> {
  const next = {
    width: clamp(Math.round(width), 320, 2400),
    height: clamp(Math.round(height), 200, 1600),
  };
  if (Math.abs(next.width - viewport.width) < 8 && Math.abs(next.height - viewport.height) < 8) {
    return { ...viewport };
  }
  viewport = next;
  await page.setViewportSize(next);
  if (session !== null) {
    await stopScreencast({ keepFrame: true });
    await startScreencast(page);
  }
  return { ...viewport };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface ScreencastEvent {
  data: string;
  sessionId: number;
  metadata?: { deviceWidth?: number; deviceHeight?: number };
}
