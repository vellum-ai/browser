/**
 * Plugin config, read from `<pluginDir>/config.json`.
 *
 * `config.json` is a preserved entry: the user edits it in place and the file
 * survives upgrades and re-installs. Everything here therefore treats the file
 * as untrusted input — a malformed value falls back to its default rather than
 * failing a request.
 *
 * Routes are loaded lazily per request and this module is shared across them,
 * so the file is re-read whenever its mtime changes. An edit applies to the
 * next request with no restart.
 */

import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Backends the assistant's browser stack can be pinned to. */
export const BROWSER_MODES = [
  "auto",
  "extension",
  "cdp-inspect",
  "local",
] as const;

export type BrowserMode = (typeof BROWSER_MODES)[number];

export interface BrowserAppConfig {
  /**
   * Browser session the app drives. A session is the isolation unit for page
   * state, cookies, and the snapshot element map, so keeping the app off the
   * `default` session means browsing here never disturbs the pages the model
   * is driving from a conversation.
   */
  sessionId: string;
  /** Backend to pin every operation to. `auto` lets the assistant choose. */
  browserMode: BrowserMode;
  /** URL to load when the app opens. Empty shows the app's empty state. */
  homeUrl: string;
  /**
   * Where address-bar input that is not a URL goes. `{query}` is replaced with
   * the percent-encoded phrase. Empty disables searching, so non-URL input is
   * rejected instead of being sent anywhere.
   */
  searchUrlTemplate: string;
  /** Per-operation timeout. Page loads and auth challenges can be slow. */
  commandTimeoutMs: number;
  /**
   * Absolute path to the `assistant` CLI. Empty auto-detects; set this when
   * the binary lives somewhere the detection in `assistant-cli.ts` misses.
   */
  assistantBin: string;
}

export const DEFAULT_CONFIG: BrowserAppConfig = {
  sessionId: "browser-app",
  browserMode: "auto",
  homeUrl: "",
  searchUrlTemplate: "https://duckduckgo.com/?q={query}",
  commandTimeoutMs: 60_000,
  assistantBin: "",
};

const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 180_000;

/**
 * The plugin root. This module sits at `<pluginDir>/src/config.ts`, so the
 * root is two directories up from the file itself — resolved from the module's
 * own URL rather than the process CWD, which is the daemon's, not ours.
 */
export const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

const CONFIG_PATH = join(PLUGIN_DIR, "config.json");

interface ConfigCache {
  mtimeMs: number;
  value: BrowserAppConfig;
}

let cache: ConfigCache | null = null;

function configMtimeMs(): number | null {
  try {
    return statSync(CONFIG_PATH).mtimeMs;
  } catch {
    return null;
  }
}

function readString(raw: Record<string, unknown>, key: keyof BrowserAppConfig): string | null {
  const value = raw[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function coerce(raw: unknown): BrowserAppConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_CONFIG };
  }
  const record = raw as Record<string, unknown>;

  const mode = readString(record, "browserMode");
  const timeout = record.commandTimeoutMs;

  return {
    sessionId: readString(record, "sessionId") ?? DEFAULT_CONFIG.sessionId,
    browserMode: isBrowserMode(mode) ? mode : DEFAULT_CONFIG.browserMode,
    // homeUrl and searchUrlTemplate are meaningfully empty, so they do not go
    // through readString's "blank means unset" collapse — a user clearing
    // either one must stay cleared rather than snapping back to the default.
    homeUrl: typeof record.homeUrl === "string" ? record.homeUrl.trim() : DEFAULT_CONFIG.homeUrl,
    searchUrlTemplate:
      typeof record.searchUrlTemplate === "string"
        ? record.searchUrlTemplate.trim()
        : DEFAULT_CONFIG.searchUrlTemplate,
    commandTimeoutMs:
      typeof timeout === "number" && Number.isFinite(timeout)
        ? Math.min(Math.max(Math.round(timeout), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
        : DEFAULT_CONFIG.commandTimeoutMs,
    assistantBin: readString(record, "assistantBin") ?? DEFAULT_CONFIG.assistantBin,
  };
}

/** Narrow an arbitrary string to a supported browser mode. */
export function isBrowserMode(value: unknown): value is BrowserMode {
  return (
    typeof value === "string" && (BROWSER_MODES as readonly string[]).includes(value)
  );
}

/**
 * Read the plugin's config, re-parsing only when `config.json` has changed.
 * A missing or unparseable file yields the defaults.
 */
export async function loadConfig(): Promise<BrowserAppConfig> {
  const mtimeMs = configMtimeMs();
  if (mtimeMs === null) {
    return { ...DEFAULT_CONFIG };
  }
  if (cache && cache.mtimeMs === mtimeMs) {
    return cache.value;
  }

  let value: BrowserAppConfig;
  try {
    value = coerce(JSON.parse(await readFile(CONFIG_PATH, "utf-8")));
  } catch {
    value = { ...DEFAULT_CONFIG };
  }

  cache = { mtimeMs, value };
  return value;
}

/** Drop the memoized config. Exported for the `init` hook and for tests. */
export function resetConfigCache(): void {
  cache = null;
}
