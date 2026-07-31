/**
 * `shutdown` hook: close the browser.
 *
 * Now that the plugin holds a real process rather than shelling out per
 * operation, it owns that process end-to-end. Without this, a daemon restart or
 * an in-place redeploy would orphan a Chromium and leave the profile's lock
 * file behind, and the next launch would fail against its own leftovers.
 *
 * `ShutdownContext` carries no logger, so this stays silent; `closeBrowser` is
 * idempotent and swallows a teardown error rather than throwing out of a hook
 * that runs while the daemon is already on its way down.
 */

import { type HookFunction, type ShutdownContext } from "@vellumai/plugin-api";

import { closeBrowser } from "../src/browser.js";

const shutdown: HookFunction<ShutdownContext> = async () => {
  await closeBrowser();
};

export default shutdown;
