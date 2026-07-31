/**
 * `POST /x/plugins/browser/close` — shut the browser down.
 *
 * Frees the memory a Chromium holds when the panel is not in use. The profile
 * in `data/` is untouched, so cookies and logins survive: the next navigation
 * relaunches into the same signed-in state.
 */

import { closeBrowser } from "../src/browser.js";
import { handle, ok } from "../src/http.js";

export interface CloseBody {
  closed: true;
}

export async function POST(): Promise<Response> {
  return handle(async () => {
    await closeBrowser();
    const body: CloseBody = { closed: true };
    return ok(body);
  });
}
