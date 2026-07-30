/**
 * `POST /x/plugins/browser/act` — interact with the page.
 *
 * Body: `{ "action": "click", "elementId": "e7" }`. One route covers every
 * interaction because they all share the same shape — validate arguments, run
 * one operation, return the resulting view — and the app's element list needs
 * exactly one endpoint to post to.
 *
 * `action` is checked against the table below rather than passed through, so
 * the route cannot be used to reach an operation the app does not offer.
 * Interactions target the element ids from the most recent snapshot, which is
 * why every response carries a fresh view: the ids are only valid until the
 * page changes.
 */

import { runBrowserOperation } from "../src/assistant-cli.js";
import type { SupportedOperation } from "../src/assistant-cli.js";
import { BrowserCommandError } from "../src/assistant-cli.js";
import { loadConfig } from "../src/config.js";
import {
  handle,
  ok,
  optionalNumber,
  optionalString,
  readJson,
  requireString,
} from "../src/http.js";
import { unwrapFence } from "../src/page.js";
import { captureView } from "../src/view.js";

/** Longest operation summary the app's status line will show. */
const MAX_MESSAGE_CHARS = 240;

const SCROLL_DIRECTIONS = new Set(["up", "down", "left", "right"]);

type ActionBuilder = (body: Record<string, unknown>) => Record<string, unknown>;

/** Read the element target shared by every element-addressed action. */
function target(
  body: Record<string, unknown>,
  { required }: { required: boolean },
): Record<string, unknown> {
  const elementId = optionalString(body, "elementId");
  const selector = optionalString(body, "selector");
  if (required && elementId === undefined && selector === undefined) {
    throw new BrowserCommandError("Provide `elementId` or `selector`.", { status: 400 });
  }
  return {
    ...(elementId === undefined ? {} : { element_id: elementId }),
    ...(selector === undefined ? {} : { selector }),
  };
}

/**
 * The actions the app can request, and how each one's arguments map onto the
 * browser operation's input keys.
 */
const ACTIONS: Record<string, { operation: SupportedOperation; build: ActionBuilder }> = {
  click: {
    operation: "click",
    build: (body) => target(body, { required: true }),
  },
  hover: {
    operation: "hover",
    build: (body) => target(body, { required: true }),
  },
  type: {
    operation: "type",
    build: (body) => ({
      text: requireString(body, "text"),
      // Both flags are only sent when the app asks for the non-default, so the
      // operation's own defaults (clear first, do not submit) stay in charge.
      ...(body.pressEnter === true ? { press_enter: true } : {}),
      ...(body.clearFirst === false ? { clear_first: false } : {}),
      ...target(body, { required: false }),
    }),
  },
  "press-key": {
    operation: "press-key",
    build: (body) => ({
      key: requireString(body, "key"),
      ...target(body, { required: false }),
    }),
  },
  scroll: {
    operation: "scroll",
    build: (body) => {
      const direction = requireString(body, "direction");
      if (!SCROLL_DIRECTIONS.has(direction)) {
        throw new BrowserCommandError(
          `\`direction\` must be one of ${[...SCROLL_DIRECTIONS].join(", ")}.`,
          { status: 400 },
        );
      }
      const amount = optionalNumber(body, "amount");
      return {
        direction,
        ...(amount === undefined ? {} : { amount }),
        ...target(body, { required: false }),
      };
    },
  },
  "select-option": {
    operation: "select-option",
    build: (body) => {
      const value = optionalString(body, "value");
      const label = optionalString(body, "label");
      const index = optionalNumber(body, "index");
      if (value === undefined && label === undefined && index === undefined) {
        throw new BrowserCommandError("Provide `value`, `label`, or `index`.", {
          status: 400,
        });
      }
      return {
        ...(value === undefined ? {} : { value }),
        ...(label === undefined ? {} : { label }),
        ...(index === undefined ? {} : { index }),
        ...target(body, { required: true }),
      };
    },
  },
};

/**
 * Summarize what the operation reported, for the app's status line. The
 * operation's own message names the element it acted on, which is more useful
 * than anything this route could reconstruct — but it can quote page text, so
 * the fence comes off and the length is capped before it is rendered.
 */
function summarize(content: string, fallback: string): string {
  const { body } = unwrapFence(content);
  const firstLine = body.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  if (firstLine === "") {
    return fallback;
  }
  return firstLine.length > MAX_MESSAGE_CHARS
    ? `${firstLine.slice(0, MAX_MESSAGE_CHARS)}…`
    : firstLine;
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const config = await loadConfig();
    const body = await readJson(request);
    const action = requireString(body, "action");

    const spec = ACTIONS[action];
    if (spec === undefined) {
      throw new BrowserCommandError(
        `Unsupported action \`${action}\`. Expected one of ${Object.keys(ACTIONS).join(", ")}.`,
        { status: 400 },
      );
    }

    const result = await runBrowserOperation(spec.operation, spec.build(body), config);
    const view = await captureView(config, {
      message: summarize(result.content, `${action} done`),
    });
    return ok(view);
  });
}
