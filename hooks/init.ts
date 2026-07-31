/**
 * `init` hook: get the browser running.
 *
 * Launching here rather than on the first request is what makes the app open
 * ready. A cold launch is seconds, and on a machine with no Chromium yet it is
 * a several-minute download — paid once at boot, in the background, instead of
 * by whoever types the first URL.
 *
 * Deliberately non-blocking. `init` runs inside the daemon's plugin load, a
 * thrown error aborts the plugin, and a slow one holds up boot — so the launch
 * is kicked off and its outcome logged, while `ensurePage` stays lazy and
 * single-flight. A request arriving mid-launch joins the launch already
 * running; one arriving after a failed launch retries it and gets the real
 * error in its response.
 */

import { type HookFunction, type InitContext } from "@vellumai/plugin-api";

import { browserVersion, describeBrowser, ensureContext } from "../src/browser.js";

const init: HookFunction<InitContext> = async (ctx) => {
  const { source } = describeBrowser();
  if (source === "none") {
    ctx.logger.info(
      { source },
      "No Chromium found — downloading Chrome for Testing in the background. The browser app will be usable once it finishes.",
    );
  }

  void ensureContext().then(
    () => {
      ctx.logger.info(
        { source: describeBrowser().source, version: browserVersion() },
        "Browser ready",
      );
    },
    (err: unknown) => {
      ctx.logger.warn(
        { err },
        "Could not start the browser. The app will retry on its next request.",
      );
    },
  );
};

export default init;
