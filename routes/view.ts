/**
 * `GET /x/plugins/browser/view` — re-read the current page.
 *
 * Backs the app's live-refresh toggle and its full-page switch. Read-only: it
 * captures what the page looks like now and changes nothing about it. Reloading
 * is an action, and lives in `act`.
 *
 * `?fullPage=1` captures the whole scrollable page instead of the viewport.
 */

import { boolParam, handle, ok } from "../src/http.js";
import { captureView } from "../src/view.js";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    return ok(await captureView({ fullPage: boolParam(request, "fullPage") }));
  });
}
