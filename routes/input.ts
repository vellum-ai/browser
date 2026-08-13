/**
 * `POST /x/plugins/browser/input`: pointer, wheel, keyboard, and resize.
 *
 * These are the events that have to feel instant. The route does the thing and
 * answers immediately. It does not collect elements and it does not take a
 * screenshot: the live frame stream is what the app draws next.
 */

import { BrowserError, ensurePage } from "../src/browser.js";
import {
  handle,
  ok,
  optionalNumber,
  optionalString,
  readJson,
  requireNumber,
  requireString,
} from "../src/http.js";
import { exclusive } from "../src/lock.js";
import { currentViewport, resizeViewport } from "../src/screencast.js";

const BUTTONS = new Set(["left", "right", "middle"]);

type MouseButton = "left" | "right" | "middle";

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const type = requireString(body, "type");

    return exclusive(async () => {
      const page = await ensurePage();

      switch (type) {
        case "wheel": {
          const at = pointOf(body);
          await page.mouse.move(at.x, at.y);
          await page.mouse.wheel(requireNumber(body, "deltaX"), requireNumber(body, "deltaY"));
          break;
        }
        case "move": {
          const at = pointOf(body);
          await page.mouse.move(at.x, at.y);
          break;
        }
        case "down": {
          const at = pointOf(body);
          await page.mouse.move(at.x, at.y);
          await page.mouse.down({ button: buttonOf(body) });
          break;
        }
        case "up": {
          const at = pointOf(body);
          await page.mouse.move(at.x, at.y);
          await page.mouse.up({ button: buttonOf(body) });
          break;
        }
        case "click": {
          const at = pointOf(body);
          const count = optionalNumber(body, "count");
          await page.mouse.click(at.x, at.y, {
            button: buttonOf(body),
            ...(count === undefined ? {} : { clickCount: count }),
          });
          break;
        }
        case "key": {
          await page.keyboard.press(requireString(body, "key"));
          break;
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

      return ok({ ok: true as const, ...currentViewport() });
    });
  });
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
