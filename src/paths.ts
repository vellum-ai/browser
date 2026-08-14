/**
 * On-disk locations this plugin owns.
 *
 * Resolved from this module's URL rather than the process CWD, which belongs
 * to the assistant.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This file sits at `<pluginDir>/src/paths.ts`, so the plugin root is two
 * levels up.
 */
export const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** User-editable plugin config. Preserved across upgrades. */
export const CONFIG_PATH = join(PLUGIN_DIR, "config.json");

/**
 * The Chromium profile: cookies, storage, logins. Lives under `data/` so
 * removing the plugin removes the profile with it.
 */
export const PROFILE_DIR = join(PLUGIN_DIR, "data", "profile");

/** Downloaded Lightpanda binary, not the Chromium profile. */
export const LIGHTPANDA_DIR = join(PLUGIN_DIR, "data", "engines", "lightpanda");

export const LIGHTPANDA_BIN = join(LIGHTPANDA_DIR, "lightpanda");
