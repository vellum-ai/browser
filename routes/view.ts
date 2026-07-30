/**
 * `GET /x/plugins/browser/view` — re-read the current page.
 *
 * Backs the app's reload button and its live-refresh toggle. Read-only: it
 * captures what the page looks like now and changes nothing about it.
 *
 * `?fullPage=1` captures the whole scrollable page instead of the viewport.
 */

import { boolParam, handle, ok } from "../src/http.js";
import { loadConfig } from "../src/config.js";
import { captureView } from "../src/view.js";

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const config = await loadConfig();
    const view = await captureView(config, {
      fullPage: boolParam(request, "fullPage"),
    });
    return ok(view);
  });
}
