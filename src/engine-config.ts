/**
 * Which engine the plugin launches.
 *
 * Stored in the plugin's `config.json`. Missing or malformed config is
 * Chromium Debugging, which is the shipped default and does not need an
 * install step beyond the Chromium `init` already runs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { CONFIG_PATH } from "./paths.js";

export const ENGINE_IDS = ["chromium", "lightpanda"] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export function isEngineId(value: unknown): value is EngineId {
  return value === "chromium" || value === "lightpanda";
}

export function defaultEngine(): EngineId {
  return "chromium";
}

/** True when this engine can paint a live picture of the page. */
export function engineHasLiveView(engine: EngineId): boolean {
  return engine === "chromium";
}

function readRaw(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The configured engine, or Chromium Debugging when unset. */
export function readEngine(): EngineId {
  const engine = readRaw().engine;
  return isEngineId(engine) ? engine : defaultEngine();
}

/** Persist the default engine, keeping any other config keys. */
export function writeEngine(engine: EngineId): void {
  const next = { ...readRaw(), engine };
  writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`);
}
