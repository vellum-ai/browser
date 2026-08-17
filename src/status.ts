/**
 * The browser's state, as the app sees it.
 *
 * Shared by `GET /status` and `POST /start` so both answer with the same shape:
 * the app reads its state from one place whether it just asked or just retried.
 */

import { describeBrowser, getLastError, isRunning, isStarting } from "./browser.js";
import type { BrowserSource } from "./browser.js";
import { engineHasLiveView, readEngine } from "./engine-config.js";
import type { EngineId } from "./engine-config.js";

export interface StatusBody {
  /** True once the browser is launched and usable. */
  running: boolean;
  /** True while an install or a launch is in flight. */
  starting: boolean;
  /**
   * Which Chromium backs it, or `none` when the machine has nothing to drive
   * yet. Starting Chromium Debugging downloads Chrome for Testing when this
   * is `none`. Unused while Lightpanda is the default engine.
   */
  source: BrowserSource;
  /** Configured engine. Chromium Debugging is the shipped default. */
  engine: EngineId;
  /** True when this engine can paint a live picture of the page. */
  liveView: boolean;
  /** Why the last launch failed, when one did. */
  error: { message: string; hint: string | null } | null;
}

export function buildStatus(): StatusBody {
  const engine = readEngine();
  return {
    running: isRunning(),
    starting: isStarting(),
    source: describeBrowser().source,
    engine,
    liveView: engineHasLiveView(engine),
    error: getLastError(),
  };
}
