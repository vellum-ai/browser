/**
 * `POST /x/plugins/browser/input`: pointer, wheel, keyboard, and resize.
 *
 * These are the events that have to feel instant. The route does the thing and
 * answers immediately. It does not collect elements and it does not take a
 * screenshot: the live frame stream is what the app draws next.
 */

import { BrowserError, ensurePage } from "../src/browser.js";
import { hitTest } from "../src/hit.js";
import {
  handle,
  ok,
  optionalNumber,
  optionalString,
  readJson,
  requireString,
} from "../src/http.js";
import { exclusive } from "../src/lock.js";
import { currentViewport, resizeViewport } from "../src/screencast.js";
import { followHref, watchPage } from "../src/watch.js";

const BUTTONS = new Set(["left", "right", "middle"]);

type MouseButton = "left" | "right" | "middle";

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const type = requireString(body, "type");

    return exclusive(async () => {
      const page = await ensurePage();
      watchPage(page);

      switch (type) {
        case "wheel": {
          const at = pointOf(body);
          await page.mouse.move(at.x, at.y);
          await page.mouse.wheel(requireNumber(body, "deltaX"), requireNumber(body, "deltaY"));
          return ok(await reply(page, at, { caret: false }));
        }
        case "move": {
          const at = pointOf(body);
          await page.mouse.move(at.x, at.y);
          return ok(await reply(page, at, { caret: false }));
        }
        case "down": {
          const at = pointOf(body);
          const count = optionalNumber(body, "count");
          await page.mouse.move(at.x, at.y);
          await page.mouse.down({
            button: buttonOf(body),
            ...(count === undefined ? {} : { clickCount: count }),
          });
          return ok(await reply(page, at, { caret: true }));
        }
        case "up": {
          const at = pointOf(body);
          const count = optionalNumber(body, "count");
          const beforeUrl = page.url();
          await page.mouse.move(at.x, at.y);
          await page.mouse.up({
            button: buttonOf(body),
            ...(count === undefined ? {} : { clickCount: count }),
          });
          const hit = await hitTest(page, at.x, at.y, { caret: true });
          await followHref(page, hit.href, beforeUrl);
          return ok({ ok: true as const, ...currentViewport(), ...hit });
        }
        case "click": {
          const at = pointOf(body);
          const count = optionalNumber(body, "count");
          const beforeUrl = page.url();
          await page.mouse.click(at.x, at.y, {
            button: buttonOf(body),
            ...(count === undefined ? {} : { clickCount: count }),
          });
          const hit = await hitTest(page, at.x, at.y, { caret: true });
          await followHref(page, hit.href, beforeUrl);
          return ok({ ok: true as const, ...currentViewport(), ...hit });
        }
        case "key": {
          await page.keyboard.press(requireString(body, "key"));
          const { width, height } = currentViewport();
          const hit = await hitTest(page, Math.floor(width / 2), Math.floor(height / 2), {
            caret: true,
          });
          return ok({ ok: true as const, width, height, ...hit });
        }
        case "resize": {
          const applied = await resizeViewport(
            page,
            requireNumber(body, "width"),
            requireNumber(body, "height"),
          );
          return ok({ ok: true as const, ...applied });
        }
        default: {
          throw new BrowserError(
            `Unsupported input \`${type}\`. Expected wheel, move, down, up, click, key, or resize.`,
            { status: 400 },
          );
        }
      }
    });
  });
}

/**
 * Required number field. Kept in this file rather than `http.ts` so a route
 * reload cannot bind to a cached `http.ts` that does not export it.
 */
function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = optionalNumber(body, field);
  if (value === undefined) {
    throw new BrowserError(`\`${field}\` is required.`, { status: 400 });
  }
  return value;
}

function pointOf(body: Record<string, unknown>): { x: number; y: number } {
  const { width, height } = currentViewport();
  return {
    x: clamp(requireNumber(body, "x"), 0, Math.max(0, width - 1)),
    y: clamp(requireNumber(body, "y"), 0, Math.max(0, height - 1)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buttonOf(body: Record<string, unknown>): MouseButton {
  const value = optionalString(body, "button") ?? "left";
  if (!BUTTONS.has(value)) {
    throw new BrowserError("`button` must be left, right, or middle.", { status: 400 });
  }
  return value as MouseButton;
}

async function reply(
  page: import("playwright").Page,
  at: { x: number; y: number },
  options: { caret: boolean },
): Promise<{
  ok: true;
  width: number;
  height: number;
  cursor: string;
  caret: { x: number; y: number; height: number } | null;
  href: string | null;
}> {
  const hit = await hitTest(page, at.x, at.y, options);
  return { ok: true as const, ...currentViewport(), ...hit };
}
