/**
 * Guards on what the app may contain, given the frame it runs in.
 *
 * The host renders a plugin app in `<iframe sandbox="allow-scripts
 * allow-popups allow-popups-to-escape-sandbox">`. There is no `allow-forms`
 * and no `allow-same-origin`, and the failure mode when that is forgotten is
 * the worst kind: the browser blocks the action, no event fires, no exception
 * reaches the app, and the control simply does nothing. A `<form>` in the
 * address bar shipped exactly that — Open and Enter were both dead, with the
 * browser running fine behind them.
 *
 * These are source checks rather than DOM tests on purpose. Reproducing the bug
 * needs the compiled bundle inside a correctly-sandboxed frame, which is a
 * browser, a build step, and a host harness; the rule itself is simple enough
 * to state directly, and stating it here means it cannot regress unnoticed.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_SRC = join(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
  "apps",
  "browser",
  "src",
);

/** Every source file in the app bundle. */
function appSources(dir = APP_SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return appSources(path);
    }
    return /\.(tsx?|html)$/.test(entry) ? [path] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  return appSources()
    .filter((path) => pattern.test(readFileSync(path, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "")))
    .map((path) => path.slice(APP_SRC.length + 1));
}

describe("app source, given a sandboxed frame", () => {
  test("uses no <form> element", () => {
    // Submission is blocked without `allow-forms`, and the submit event never
    // fires — so a form's button and its Enter key both silently do nothing.
    expect(offenders(/<form[\s>]/)).toEqual([]);
  });

  test("uses no submit buttons", () => {
    // Same reason: `type="submit"` needs a form, and a form cannot work here.
    expect(offenders(/type=["']submit["']/)).toEqual([]);
  });

  test("uses no navigating anchors", () => {
    // Top-level navigation is blocked too, so an `href` is a dead control.
    expect(offenders(/<a\s[^>]*href=/)).toEqual([]);
  });

  test("finds the app sources it is meant to be checking", () => {
    // A guard that silently scans nothing passes forever.
    const sources = appSources();
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.some((path) => path.endsWith("AddressBar.tsx"))).toBe(true);
  });
});
