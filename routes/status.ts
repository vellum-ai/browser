/**
 * `GET /x/plugins/browser/status` — the app's bootstrap call.
 *
 * Reports whether the browser is up and where its executable came from. The app
 * opens on this rather than on a navigation, so a machine with no Chromium yet
 * is told so up front instead of discovering it through a failed click.
 *
 * Read-only: it never launches. `init` owns starting the browser, and a GET
 * that could trigger a five-minute download would be a poor bootstrap call.
 */

import { describeBrowser, isRunning } from "../src/browser.js";
import { handle, ok } from "../src/http.js";

export interface StatusBody {
  /** True once the browser is launched and usable. */
  running: boolean;
  /**
   * Which Chromium backs it: the machine's Google Chrome, Playwright's own
   * Chrome for Testing, or neither yet — in which case the first navigation
   * downloads Chrome for Testing.
   */
  source: "system-chrome" | "chrome-for-testing" | "none";
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    const body: StatusBody = {
      running: isRunning(),
      source: describeBrowser().source,
    };
    return ok(body);
  });
}
