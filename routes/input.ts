/**
 * `POST /x/plugins/browser/input`: pointer, wheel, keyboard, and resize.
 *
 * One request can carry a batch of events. The app coalesces moves and wheels
 * into a single POST per animation frame so each mouse tick is not its own
 * HTTP round trip through the host bridge.
 *
 * The route does the thing and answers immediately. Link following runs after
 * the response is sent, so a click cannot hold the input lock for a navigation.
 */

import { BrowserError } from "../src/errors.js";
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
import { currentViewport, latestFrame, resizeViewport } from "../src/screencast.js";
import { ensurePage } from "../src/session.js";
import { followHref, watchPage } from "../src/watch.js";

const BUTTONS = new Set(["left", "right", "middle"]);

type MouseButton = "left" | "right" | "middle";

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const events = eventsOf(body);
    const since = optionalNumber(body, "since") ?? 0;

    return exclusive(async () => {
      const page = await ensurePage();
      watchPage(page);

      let lastPoint: { x: number; y: number } | null = null;
      let wantCaret = false;
      let follow: { beforeUrl: string } | null = null;

      for (const event of events) {
        const type = requireString(event, "type");
        switch (type) {
          case "wheel": {
            const at = pointOf(event);
            lastPoint = at;
            await page.mouse.move(at.x, at.y);
            await page.mouse.wheel(requireNumber(event, "deltaX"), requireNumber(event, "deltaY"));
            break;
          }
          case "move": {
            const at = pointOf(event);
            lastPoint = at;
            await page.mouse.move(at.x, at.y);
            break;
          }
          case "down": {
            const at = pointOf(event);
            lastPoint = at;
            wantCaret = true;
            const count = optionalNumber(event, "count");
            await page.mouse.move(at.x, at.y);
            await page.mouse.down({
              button: buttonOf(event),
              ...(count === undefined ? {} : { clickCount: count }),
            });
            break;
          }
          case "up": {
            const at = pointOf(event);
            lastPoint = at;
            wantCaret = true;
            const count = optionalNumber(event, "count");
            const beforeUrl = page.url();
            await page.mouse.move(at.x, at.y);
            await page.mouse.up({
              button: buttonOf(event),
              ...(count === undefined ? {} : { clickCount: count }),
            });
            follow = { beforeUrl };
            break;
          }
          case "click": {
            const at = pointOf(event);
            lastPoint = at;
            wantCaret = true;
            const count = optionalNumber(event, "count");
            const beforeUrl = page.url();
            await page.mouse.click(at.x, at.y, {
              button: buttonOf(event),
              ...(count === undefined ? {} : { clickCount: count }),
            });
            follow = { beforeUrl };
            break;
          }
          case "key": {
            wantCaret = true;
            await page.keyboard.press(requireString(event, "key"));
            break;
          }
          case "resize": {
            await resizeViewport(page, requireNumber(event, "width"), requireNumber(event, "height"));
            break;
          }
          default: {
            throw new BrowserError(
              `Unsupported input \`${type}\`. Expected wheel, move, down, up, click, key, or resize.`,
              { status: 400 },
            );
          }
        }
      }

      if (lastPoint === null && wantCaret) {
        const size = currentViewport();
        lastPoint = { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) };
      }
      const at = lastPoint ?? { x: 0, y: 0 };
      const hit =
        lastPoint === null
          ? { cursor: "default" as const, caret: null, href: null }
          : await hitTest(page, at.x, at.y, { caret: wantCaret });
      if (follow !== null) {
        void followHref(page, hit.href, follow.beforeUrl);
      }

      const frame = latestFrame();
      const screenshot = frame !== null && frame.seq > since ? frame.jpeg : null;
      const seq = frame?.seq ?? since;

      return ok({
        ok: true as const,
        ...currentViewport(),
        ...hit,
        screenshot,
        seq,
        url: page.url(),
      });
    });
  });
}

function eventsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(body.events)) {
    if (body.events.length === 0) {
      throw new BrowserError("`events` must not be empty.", { status: 400 });
    }
    return body.events.map((event, index) => {
      if (typeof event !== "object" || event === null || Array.isArray(event)) {
        throw new BrowserError(`\`events[${index}]\` must be an object.`, { status: 400 });
      }
      return event as Record<string, unknown>;
    });
  }
  return [body];
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
