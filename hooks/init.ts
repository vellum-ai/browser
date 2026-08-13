/**
 * `init` hook: install Chromium.
 *
 * A plugin's dependencies install with `--ignore-scripts`, so Playwright's
 * browser download never runs and a fresh install has no Chromium. Paying that
 * download here (once, in the background) means the app can open a window on
 * load instead of asking the user to click Start first.
 *
 * This file must not statically import `src/browser.ts`. That module loads
 * Playwright, and the assistant's hook import has a short timeout. A static
 * import here is how init silently never runs on a fresh install. The browser
 * module is loaded dynamically after this hook has already been accepted.
 *
 * Deliberately non-blocking. `init` runs inside the assistant's plugin load, a
 * thrown error aborts the plugin, and a slow one holds up boot, so the install
 * is kicked off and its outcome logged. The window is not opened here: that
 * happens when the app loads (and the Start button remains as a retry).
 */

import { type HookFunction, type InitContext } from "@vellumai/plugin-api";

const init: HookFunction<InitContext> = async (ctx) => {
  void import("../src/browser.js")
    .then(async ({ describeBrowser, ensureInstalled }) => {
      const { source } = describeBrowser();
      if (source === "none") {
        ctx.logger.info(
          { source },
          "No Chromium found. Downloading Chrome for Testing in the background.",
        );
      }
      await ensureInstalled();
      ctx.logger.info({ source: describeBrowser().source }, "Chromium is installed");
    })
    .catch((err: unknown) => {
      ctx.logger.warn(
        { err },
        "Could not install Chromium. The app will retry when it opens.",
      );
    });
};

export default init;
