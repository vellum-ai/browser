/**
 * Guards on how Chromium is installed and how the window is opened.
 *
 * The assistant's hook import has a short timeout. A static import of
 * Playwright (via `src/browser.ts`) is how `init` silently never runs on a
 * fresh install, which is exactly the dead end where the app asks the user to
 * click Start before Chromium has even been fetched. These are source checks
 * because reproducing that timeout needs a daemon, a plugin install, and a
 * first-load of Playwright.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

describe("init installs Chromium without importing Playwright", () => {
  const init = source("hooks/init.ts");

  test("does not statically import the browser module or Playwright", () => {
    expect(init).not.toMatch(/^import .*from ["'].*\/browser/m);
    expect(init).not.toMatch(/from ["']playwright["']/);
  });

  test("loads the browser module dynamically and installs, without launching", () => {
    expect(init).toContain('import("../src/browser.js")');
    expect(init).toContain("ensureInstalled");
    expect(init).not.toContain("ensureContext");
  });
});

describe("the app opens the window on load", () => {
  const app = source("apps/browser/src/components/App.tsx");

  test("starts the browser when status says it is not running", () => {
    expect(app).toContain("startBrowser");
    expect(app).toMatch(/if \(!bootstrap\.running\)/);
    expect(app).toContain("await begin()");
  });

  test("keeps the Start button as a retry", () => {
    expect(app).toContain("onRetry={() => void begin()}");
    expect(source("apps/browser/src/components/StartupBanner.tsx")).toMatch(
      />\s*Start\s*</,
    );
  });
});
