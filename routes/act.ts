/**
 * `POST /x/plugins/browser/act` — interact with the page.
 *
 * Body: `{ "action": "click", "elementId": "e7" }`. One route covers every
 * interaction because they all share the same shape — validate arguments, do
 * one thing to the page, return the resulting view — and the app needs exactly
 * one endpoint to post to.
 *
 * `action` is checked against the table below rather than passed through, so a
 * request cannot reach behavior the app does not offer.
 *
 * Element ids come from the most recent collection, which is why every response
 * carries a fresh view: acting on a stale id resolves to no element and fails
 * with a message saying so, rather than hitting whatever now sits in its place.
 */

import type { Page } from "playwright";

import { BrowserError, ensurePage } from "../src/browser.js";
import {
  handle,
  ok,
  optionalNumber,
  optionalString,
  readJson,
  requireString,
} from "../src/http.js";
import { elementLocator } from "../src/snapshot.js";
import { captureView } from "../src/view.js";

/** Ceiling on a single interaction, so a hung page fails instead of hanging. */
const ACTION_TIMEOUT_MS = 15_000;

const SCROLL_DIRECTIONS = new Set(["up", "down", "left", "right"]);

/** Pixels a scroll moves when the app does not say. */
const SCROLL_AMOUNT = 500;

type Body = Record<string, unknown>;

/** Resolve the element an action targets, failing clearly when it is gone. */
async function target(page: Page, body: Body) {
  const locator = elementLocator(page, requireString(body, "elementId"));
  if ((await locator.count()) === 0) {
    throw new BrowserError(
      "That element is no longer on the page — it may have changed since the list was read.",
      { status: 409, hint: "Reload the page to pick up the current elements." },
    );
  }
  return locator.first();
}

/**
 * Each action: what it does, and the note the status line shows afterwards.
 * Returning the message from the action keeps "what happened" next to the code
 * that made it happen.
 */
const ACTIONS: Record<string, (page: Page, body: Body) => Promise<string>> = {
  click: async (page, body) => {
    const locator = await target(page, body);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    return "Clicked";
  },

  hover: async (page, body) => {
    const locator = await target(page, body);
    await locator.hover({ timeout: ACTION_TIMEOUT_MS });
    return "Hovered";
  },

  "click-at": async (page, body) => {
    const x = optionalNumber(body, "x");
    const y = optionalNumber(body, "y");
    if (x === undefined || y === undefined) {
      throw new BrowserError("`x` and `y` are required.", { status: 400 });
    }
    await page.mouse.click(x, y);
    return `Clicked at ${Math.round(x)}, ${Math.round(y)}`;
  },

  type: async (page, body) => {
    const locator = await target(page, body);
    const text = requireString(body, "text");
    if (body.clearFirst === false) {
      await locator.focus({ timeout: ACTION_TIMEOUT_MS });
      await locator.press("End", { timeout: ACTION_TIMEOUT_MS });
      await locator.type(text, { timeout: ACTION_TIMEOUT_MS });
    } else {
      await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
    }
    if (body.pressEnter === true) {
      await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
      return "Typed and submitted";
    }
    return "Typed";
  },

  "press-key": async (page, body) => {
    const key = requireString(body, "key");
    const elementId = optionalString(body, "elementId");
    if (elementId === undefined) {
      await page.keyboard.press(key);
    } else {
      await (await target(page, body)).press(key, { timeout: ACTION_TIMEOUT_MS });
    }
    return `Pressed ${key}`;
  },

  scroll: async (page, body) => {
    const direction = requireString(body, "direction");
    if (!SCROLL_DIRECTIONS.has(direction)) {
      throw new BrowserError(
        `\`direction\` must be one of ${[...SCROLL_DIRECTIONS].join(", ")}.`,
        { status: 400 },
      );
    }
    const amount = optionalNumber(body, "amount") ?? SCROLL_AMOUNT;
    const [dx, dy] =
      direction === "up"
        ? [0, -amount]
        : direction === "down"
          ? [0, amount]
          : direction === "left"
            ? [-amount, 0]
            : [amount, 0];
    await page.mouse.wheel(dx, dy);
    return `Scrolled ${direction}`;
  },

  "select-option": async (page, body) => {
    const locator = await target(page, body);
    const value = optionalString(body, "value");
    const label = optionalString(body, "label");
    const index = optionalNumber(body, "index");

    if (value === undefined && label === undefined && index === undefined) {
      throw new BrowserError("Provide `value`, `label`, or `index`.", { status: 400 });
    }

    const selected = await locator.selectOption(
      value !== undefined ? { value } : label !== undefined ? { label } : { index: index! },
      { timeout: ACTION_TIMEOUT_MS },
    );
    if (selected.length === 0) {
      throw new BrowserError("No option matched.", { status: 404 });
    }
    return "Selected";
  },

  // Real history, which is the whole reason the page is driven in-process:
  // Playwright returns null when there was nowhere to go, so the app is told
  // that plainly instead of being handed an unchanged page with no explanation.
  back: async (page) => {
    const response = await page.goBack({ timeout: ACTION_TIMEOUT_MS });
    return response === null ? "No page to go back to" : "Went back";
  },

  forward: async (page) => {
    const response = await page.goForward({ timeout: ACTION_TIMEOUT_MS });
    return response === null ? "No page to go forward to" : "Went forward";
  },

  reload: async (page) => {
    await page.reload({ timeout: ACTION_TIMEOUT_MS });
    return "Reloaded";
  },
};

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const action = requireString(body, "action");

    const run = ACTIONS[action];
    if (run === undefined) {
      throw new BrowserError(
        `Unsupported action \`${action}\`. Expected one of ${Object.keys(ACTIONS).join(", ")}.`,
        { status: 400 },
      );
    }

    const page = await ensurePage();
    const message = await run(page, body);
    return ok(await captureView({ fullPage: body.fullPage === true, message }));
  });
}
