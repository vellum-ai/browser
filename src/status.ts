/**
 * The browser's state, as the app sees it.
 *
 * Shared by `GET /status` and `POST /start` so both answer with the same shape:
 * the app reads its state from one place whether it just asked or just retried.
 */

import { describeBrowser, getLastError, isRunning, isStarting } from "./browser.js";
import type { BrowserSource } from "./browser.js";

export interface StatusBody {
  /** True once the browser is launched and usable. */
  running: boolean;
  /** True while a launch is in flight. */
  starting: boolean;
  /**
   * Which Chromium backs it, or `none` when the machine has nothing to drive
   * yet — in which case starting downloads Chrome for Testing.
   */
  source: BrowserSource;
  /** Why the last launch failed, when one did. */
  error: { message: string; hint: string | null } | null;
}

export function buildStatus(): StatusBody {
  return {
    running: isRunning(),
    starting: isStarting(),
    source: describeBrowser().source,
    error: getLastError(),
  };
}
