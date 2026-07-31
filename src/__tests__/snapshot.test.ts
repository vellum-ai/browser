/**
 * Tests for the in-page collector, run against a real Chromium.
 *
 * The collector's body executes inside the page, where types are erased and a
 * mistake shows up as a missing element rather than an error. Driving a real
 * browser is the only way to actually exercise it — and now that Playwright is
 * a direct dependency, it costs nothing extra to do so.
 *
 * The suite skips when no Chromium is available (a plugin installs with
 * `--ignore-scripts`, so a bare checkout may genuinely have none) rather than
 * failing and looking like a broken collector.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

import { collectSnapshot, elementLocator, extractText } from "../snapshot.js";
import { BrowserError } from "../browser.js";

const PAGE = `<!doctype html>
<html><head><title>Fixture</title></head><body>
  <a href="https://example.com/docs">Read the docs</a>
  <button aria-label="Close dialog"></button>
  <input type="search" placeholder="Search" value="cats">
  <label for="country">Country</label>
  <select id="country"><option value="us">United States</option><option value="fr">France</option></select>
  <button style="display:none">Hidden button</button>
  <span hidden><a href="/nope">Hidden link</a></span>
  <div role="button" tabindex="0">Custom control</div>
  <p>Body copy that should show up in the extracted text.</p>
</body></html>`;

/** A Chromium this machine can actually launch, or null to skip the suite. */
function resolveExecutable(): string | null {
  try {
    if (existsSync(chromium.executablePath())) {
      return chromium.executablePath();
    }
  } catch {
    // No browser registry at all.
  }
  for (const candidate of [
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const executablePath = resolveExecutable();
const describeWithBrowser = executablePath === null ? describe.skip : describe;

describeWithBrowser("collectSnapshot", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executablePath ?? undefined });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(PAGE);
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("reports the page identity", async () => {
    const snapshot = await collectSnapshot(page);
    expect(snapshot.title).toBe("Fixture");
    expect(snapshot.scroll).toEqual({ x: 0, y: 0 });
  });

  test("finds the interactive elements and skips the invisible ones", async () => {
    const snapshot = await collectSnapshot(page);
    const names = snapshot.elements.map((element) => element.name);

    expect(names).toContain("Read the docs");
    expect(names).toContain("Close dialog");
    expect(names).toContain("Custom control");
    // `display:none` and a `hidden` ancestor both make an element unpointable.
    expect(names).not.toContain("Hidden button");
    expect(names).not.toContain("Hidden link");
  });

  test("derives roles from tags and honors an explicit role", async () => {
    const snapshot = await collectSnapshot(page);
    const byName = new Map(snapshot.elements.map((el) => [el.name, el]));

    expect(byName.get("Read the docs")?.role).toBe("link");
    expect(byName.get("Close dialog")?.role).toBe("button");
    expect(byName.get("Search")?.role).toBe("searchbox");
    expect(byName.get("Custom control")?.role).toBe("button");
    expect(snapshot.elements.find((el) => el.role === "combobox")).toBeDefined();
  });

  test("names a select from its label, not from its option text", async () => {
    const snapshot = await collectSnapshot(page);
    const select = snapshot.elements.find((el) => el.role === "combobox");

    // innerText on a <select> concatenates every option, which reads as
    // "United States France" rather than as a name for the control.
    expect(select?.name).toBe("Country");
    expect(select?.value).toBe("us");
  });

  test("carries the attributes and value the app acts on", async () => {
    const snapshot = await collectSnapshot(page);
    const byName = new Map(snapshot.elements.map((el) => [el.name, el]));

    expect(byName.get("Read the docs")?.attrs.href).toBe("https://example.com/docs");
    expect(byName.get("Search")?.value).toBe("cats");
  });

  test("reports geometry the app can draw a box from", async () => {
    const snapshot = await collectSnapshot(page);
    const link = snapshot.elements.find((el) => el.name === "Read the docs");

    expect(link?.rect.width).toBeGreaterThan(0);
    expect(link?.rect.height).toBeGreaterThan(0);
    // Unscrolled, viewport and document coordinates agree.
    expect(link?.pageRect).toEqual(link?.rect as never);
  });

  test("assigns ids that resolve back to the same element", async () => {
    const snapshot = await collectSnapshot(page);
    const link = snapshot.elements.find((el) => el.name === "Read the docs");
    expect(link).toBeDefined();

    const located = elementLocator(page, link!.eid);
    expect(await located.getAttribute("href")).toBe("https://example.com/docs");
  });

  test("an id from no collection resolves to nothing rather than something else", async () => {
    await expect(elementLocator(page, "e9999").count()).resolves.toBe(0);
  });

  test("rejects a malformed id instead of building a selector from it", () => {
    expect(() => elementLocator(page, 'e1"] , [href')).toThrow(BrowserError);
  });
});

describeWithBrowser("extractText", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executablePath ?? undefined });
    page = await browser.newPage();
    await page.setContent(PAGE);
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("returns the visible text and omits hidden content", async () => {
    const { text } = await extractText(page, false);
    expect(text).toContain("Body copy that should show up in the extracted text.");
    expect(text).not.toContain("Hidden link");
    expect(text).not.toContain("Links:");
  });

  test("appends links when asked", async () => {
    const { text } = await extractText(page, true);
    expect(text).toContain("Links:");
    expect(text).toContain("[Read the docs](https://example.com/docs)");
  });
});
