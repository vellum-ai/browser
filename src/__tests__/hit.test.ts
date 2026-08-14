/**
 * Tests for the hit-test helpers that do not need a page.
 *
 * Cursor keywords and href safety are the boundary the panel trusts: a
 * computed style or an `<a href>` from the page becomes CSS and a navigation
 * target. Those two functions are asserted here so a bad string cannot leak
 * into either.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

import { hitTest, isDifferentDocument, isSafeHref, normalizeCursor } from "../hit.js";

describe("normalizeCursor", () => {
  test("keeps a known keyword", () => {
    expect(normalizeCursor("pointer")).toBe("pointer");
    expect(normalizeCursor("text")).toBe("text");
    expect(normalizeCursor("not-allowed")).toBe("not-allowed");
  });

  test("treats auto as default", () => {
    expect(normalizeCursor("auto")).toBe("default");
  });

  test("uses the fallback after a url() cursor", () => {
    expect(normalizeCursor("url(https://example.com/c.cur) 4 4, pointer")).toBe("pointer");
  });

  test("rejects an unknown value", () => {
    expect(normalizeCursor("")).toBe("default");
    expect(normalizeCursor("url(https://example.com/c.cur)")).toBe("default");
    expect(normalizeCursor("totally-made-up")).toBe("default");
  });
});

describe("isSafeHref", () => {
  test("accepts http and https", () => {
    expect(isSafeHref("https://example.com/login")).toBe(true);
    expect(isSafeHref("http://example.com/login")).toBe(true);
  });

  test("rejects schemes the page must not follow", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,hi")).toBe(false);
    expect(isSafeHref("file:///etc/passwd")).toBe(false);
    expect(isSafeHref("not a url")).toBe(false);
  });
});

describe("isDifferentDocument", () => {
  test("treats a path change as a new document", () => {
    expect(isDifferentDocument("https://example.com/login", "https://example.com/")).toBe(true);
  });

  test("treats a hash-only change as the same document", () => {
    expect(isDifferentDocument("https://example.com/#signup", "https://example.com/")).toBe(false);
    expect(isDifferentDocument("https://example.com/", "https://example.com/")).toBe(false);
  });
});

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

const PAGE = `<!doctype html>
<html><head><title>Hit</title>
<style>
  a { cursor: pointer; }
  input { cursor: text; position: absolute; left: 20px; top: 80px; width: 200px; height: 32px; }
</style>
</head><body>
  <a href="https://example.com/login" style="position:absolute;left:20px;top:20px;width:80px;height:24px">Sign in</a>
  <input id="name" type="text" value="Alice">
</body></html>`;

describeWithBrowser("hitTest", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executablePath ?? undefined });
    page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(PAGE);
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("reports pointer and the link href under a Sign in hit", async () => {
    const hit = await hitTest(page, 40, 30, { caret: false });
    expect(hit.cursor).toBe("pointer");
    expect(hit.href).toBe("https://example.com/login");
    expect(hit.caret).toBeNull();
  });

  test("reports a caret after focusing the text field", async () => {
    await page.click("#name");
    const box = await page.locator("#name").boundingBox();
    expect(box).not.toBeNull();
    const hit = await hitTest(page, (box?.x ?? 0) + 8, (box?.y ?? 0) + 8, { caret: true });
    expect(hit.cursor).toBe("text");
    expect(hit.caret).not.toBeNull();
    expect(hit.caret?.height ?? 0).toBeGreaterThan(8);
  });
});
