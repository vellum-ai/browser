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
import { existsSync, readFileSync } from "node:fs";
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

describe("the app is a live view, not a screenshot picker", () => {
  test("does not ship the element list or text rail", () => {
    expect(existsSync(join(ROOT, "apps/browser/src/components/ElementList.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "apps/browser/src/components/TextPanel.tsx"))).toBe(false);
    expect(source("apps/browser/src/components/App.tsx")).not.toContain("ElementList");
    expect(source("apps/browser/src/components/App.tsx")).not.toContain("TextPanel");
    expect(source("apps/browser/src/components/App.tsx")).not.toContain("Full page");
    expect(source("apps/browser/src/styles.css")).not.toContain(".element-label");
  });

  test("forwards wheel to the page and draws a live frame stream", () => {
    const viewport = source("apps/browser/src/components/Viewport.tsx");
    expect(viewport).toContain('addEventListener("wheel"');
    expect(viewport).toContain("passive: false");
    expect(viewport).toContain("fetchFrame");
    expect(source("apps/browser/src/api.ts")).toContain('type: "wheel"');
    expect(existsSync(join(ROOT, "routes/frame.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "routes/input.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "routes/view.ts"))).toBe(false);
  });

  test("clicks the page as one Playwright click, in the panel's own size", () => {
    const viewport = source("apps/browser/src/components/Viewport.tsx");
    expect(viewport).toContain('type: "click"');
    expect(viewport).toContain("size.current.width");
    expect(viewport).not.toContain("frameRef");
    expect(source("apps/browser/src/api.ts")).toContain("inputChain");
    expect(source("routes/input.ts")).toContain("exclusive");
    expect(source("routes/input.ts")).not.toMatch(
      /import\s*\{[^}]*requireNumber[^}]*\}\s*from\s*["'].*http/,
    );
    expect(source("routes/frame.ts")).toContain("currentViewport()");
  });
});

describe("the chrome is just the address bar", () => {
  test("has no Open button, Ask the assistant, or Close browser", () => {
    const app = source("apps/browser/src/components/App.tsx");
    const bar = source("apps/browser/src/components/AddressBar.tsx");
    expect(bar).not.toContain("Open");
    expect(bar).not.toContain('class="go"');
    expect(app).not.toContain("Ask the assistant");
    expect(app).not.toContain("Close browser");
    expect(app).not.toContain("canRelayPrompt");
    expect(app).not.toContain("closeBrowser");
  });
});
