/**
 * `GET|POST /x/plugins/browser/session`: windows and tabs.
 *
 * GET is the tree the chrome draws. POST mutates it: new/close/select for a
 * tab or a window. There is always at least one window and at least one tab.
 */

import { BrowserError, isRunning } from "../src/browser.js";
import { handle, ok, optionalString, readJson, requireString } from "../src/http.js";
import { exclusive } from "../src/lock.js";
import {
  closeTab,
  closeWindow,
  newTab,
  newWindow,
  selectTab,
  selectWindow,
  snapshot,
} from "../src/session.js";
import type { SessionInfo } from "../src/session.js";

export async function GET(): Promise<Response> {
  return handle(async () => {
    if (!isRunning()) {
      const empty: SessionInfo = { windows: [], activeWindowId: "", activeTabId: "" };
      return ok(empty);
    }
    return ok(await snapshot());
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    if (!isRunning()) {
      throw new BrowserError("The browser is not running.", { status: 409 });
    }
    const body = await readJson(request);
    const action = requireString(body, "action");

    return exclusive(async () => {
      switch (action) {
        case "new-tab": {
          return ok(await newTab(optionalString(body, "windowId")));
        }
        case "close-tab": {
          return ok(await closeTab(requireString(body, "tabId")));
        }
        case "select-tab": {
          return ok(await selectTab(requireString(body, "tabId")));
        }
        case "new-window": {
          return ok(await newWindow());
        }
        case "close-window": {
          return ok(await closeWindow(requireString(body, "windowId")));
        }
        case "select-window": {
          return ok(await selectWindow(requireString(body, "windowId")));
        }
        default: {
          throw new BrowserError(
            `Unsupported action \`${action}\`. Expected new-tab, close-tab, select-tab, new-window, close-window, or select-window.`,
            { status: 400 },
          );
        }
      }
    });
  });
}
