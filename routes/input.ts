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
import { resizeViewport } from "../src/screencast.js";

const BUTTONS = new Set(["left", "right", "middle"]);

type MouseButton = "left" | "right" | "middle";

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const type = requireString(body, "type");
    const page = await ensurePage();

    switch (type) {
      case "wheel": {
        const x = requireNumber(body, "x");
        const y = requireNumber(body, "y");
        await page.mouse.move(x, y);
        await page.mouse.wheel(requireNumber(body, "deltaX"), requireNumber(body, "deltaY"));
        break;
      }
      case "move": {
        await page.mouse.move(requireNumber(body, "x"), requireNumber(body, "y"));
        break;
      }
      case "down": {
        await page.mouse.move(requireNumber(body, "x"), requireNumber(body, "y"));
        await page.mouse.down({ button: buttonOf(body) });
        break;
      }
      case "up": {
        await page.mouse.move(requireNumber(body, "x"), requireNumber(body, "y"));
        await page.mouse.up({ button: buttonOf(body) });
        break;
      }
      case "click": {
        const count = optionalNumber(body, "count");
        await page.mouse.click(requireNumber(body, "x"), requireNumber(body, "y"), {
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
        await resizeViewport(page, requireNumber(body, "width"), requireNumber(body, "height"));
        break;
      }
      default: {
        throw new BrowserError(
          `Unsupported input \`${type}\`. Expected wheel, move, down, up, click, key, or resize.`,
          { status: 400 },
        );
      }
    }

    return ok({ ok: true as const });
  });
}

function buttonOf(body: Record<string, unknown>): MouseButton {
  const value = optionalString(body, "button") ?? "left";
  if (!BUTTONS.has(value)) {
    throw new BrowserError("`button` must be left, right, or middle.", { status: 400 });
  }
  return value as MouseButton;
}
