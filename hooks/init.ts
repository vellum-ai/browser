/**
 * `init` hook: validate config and report whether the plugin can reach the
 * assistant CLI it drives the browser through.
 *
 * The plugin keeps no durable state, so there is nothing to open here and no
 * `shutdown` counterpart. What this hook buys is attribution at boot: without
 * it, an unresolvable CLI or a mistyped `browserMode` is first discovered by
 * someone clicking a button in the app and reading a 503.
 *
 * Fail-open throughout. Throwing from `init` aborts the plugin's load, and a
 * CLI that cannot be found right now may well resolve later — the daemon
 * installs its symlink during startup, and an upgrade can move the binary — so
 * a warning is the right outcome, not a dead plugin.
 */

import { type HookFunction, type InitContext } from "@vellumai/plugin-api";

import { hasResolvableBin, resetBinCache } from "../src/assistant-cli.js";
import { isBrowserMode, loadConfig, resetConfigCache } from "../src/config.js";

/** Read `browserMode` off the raw config the host parsed, if it set one. */
function rawBrowserMode(config: unknown): unknown {
  if (typeof config !== "object" || config === null) {
    return undefined;
  }
  return (config as { browserMode?: unknown }).browserMode;
}

const init: HookFunction<InitContext> = async (ctx) => {
  // `init` runs on every boot and on in-place redeploys, so drop both memos
  // rather than carrying a previous load's answers into this one.
  resetConfigCache();
  resetBinCache();

  const config = await loadConfig();

  const configuredMode = rawBrowserMode(ctx.config);
  if (configuredMode !== undefined && !isBrowserMode(configuredMode)) {
    ctx.logger.warn(
      { configured: configuredMode, using: config.browserMode },
      'Ignoring unrecognized "browserMode" in config.json',
    );
  }

  if (!hasResolvableBin(config)) {
    ctx.logger.warn(
      { assistantBin: config.assistantBin },
      'Could not locate the `assistant` CLI. The browser app cannot drive a page until it resolves on PATH, or until "assistantBin" in config.json points at it.',
    );
    return;
  }

  ctx.logger.info(
    { session: config.sessionId, browserMode: config.browserMode },
    "Browser app ready",
  );
};

export default init;
