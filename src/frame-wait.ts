/**
 * Hold a `/frame` request until Chromium has painted something new.
 *
 * CDP only emits a screencast JPEG when the page actually composites. Waiting
 * here means the canvas only receives a data URL when there is a new picture
 * to blit, instead of the same JPEG on every poll.
 */

import { latestFrame, type Frame } from "./screencast.js";

/** How long a poll may sit waiting for the next composite. */
const WAIT_MS = 400;

const TICK_MS = 8;

/**
 * The current frame if it is newer than `since`, otherwise the current frame
 * after waiting up to {@link WAIT_MS} for one to arrive.
 */
export async function waitForFrame(since: number): Promise<Frame | null> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const frame = latestFrame();
    if (frame !== null && frame.seq > since) {
      return frame;
    }
    if (Date.now() >= deadline) {
      return frame;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, TICK_MS);
    });
  }
}
