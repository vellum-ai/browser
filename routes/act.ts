/**
 * `POST /x/plugins/browser/act`: back, forward, and reload.
 *
 * History and reload are the page's own. Pointer, wheel, and keyboard live on
 * `/input` so those can stay fast; this route is the slower, explicit chrome.
 */

import { BrowserError } from "../src/browser.js";
import { handle, ok, readJson, requireString } from "../src/http.js";
import { ensurePage } from "../src/session.js";
import { pageIdentity } from "../src/view.js";
import type { PageIdentity } from "../src/view.js";

const ACTION_TIMEOUT_MS = 15_000;

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const action = requireString(body, "action");
    const page = await ensurePage();

    let message: string;
    if (action === "back") {
      const response = await page.goBack({ timeout: ACTION_TIMEOUT_MS });
      message = response === null ? "No page to go back to" : "Went back";
    } else if (action === "forward") {
      const response = await page.goForward({ timeout: ACTION_TIMEOUT_MS });
      message = response === null ? "No page to go forward to" : "Went forward";
    } else if (action === "reload") {
      await page.reload({ timeout: ACTION_TIMEOUT_MS });
      message = "Reloaded";
    } else {
      throw new BrowserError(
        `Unsupported action \`${action}\`. Expected back, forward, or reload.`,
        { status: 400 },
      );
    }

    const identity: PageIdentity = await pageIdentity(page, message);
    return ok(identity);
  });
}
