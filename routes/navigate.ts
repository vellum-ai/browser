/**
 * `POST /x/plugins/browser/navigate` — load a page.
 *
 * Body: `{ "input": "example.com" }`, the raw address-bar value. Resolving it
 * to a URL (or a search) happens here so there is one place that decides what a
 * typed string means. Answers with a fresh view, so a navigation is a single
 * round trip.
 */

import { ensurePage } from "../src/browser.js";
import { handle, ok, readJson, requireString } from "../src/http.js";
import { resolveTarget } from "../src/url.js";
import { captureView } from "../src/view.js";

/**
 * Navigation waits for the DOM, not for every last subresource. `load` on an
 * ad-heavy page can outlast the wait by tens of seconds while the content the
 * user asked for has been on screen the whole time.
 */
const NAVIGATION_TIMEOUT_MS = 45_000;

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const input = requireString(body, "input").trim();
    const target = resolveTarget(input);

    const page = await ensurePage();
    await page.goto(target.url, {
      timeout: NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });

    return ok(
      await captureView({
        fullPage: body.fullPage === true,
        message: target.searched ? `Searched for “${input}”` : null,
      }),
    );
  });
}
