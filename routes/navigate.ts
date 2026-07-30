/**
 * `POST /x/plugins/browser/navigate` — load a page.
 *
 * Body: `{ "input": "example.com" }`, the raw address-bar value. Resolving it
 * to a URL (or a search) happens server-side so the app has one place that
 * decides what a typed string means.
 *
 * Answers with a fresh view of the page that loaded, so a navigation is a
 * single round trip.
 */

import { loadConfig } from "../src/config.js";
import { handle, ok, readJson, requireString } from "../src/http.js";
import { runBrowserOperation } from "../src/assistant-cli.js";
import { parseNavigate } from "../src/page.js";
import { isPrivateHost, resolveTarget } from "../src/url.js";
import { captureView } from "../src/view.js";
import type { PageView } from "../src/view.js";

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const config = await loadConfig();
    const body = await readJson(request);
    const input = requireString(body, "input").trim();
    const target = resolveTarget(input, config.searchUrlTemplate);

    const result = await runBrowserOperation(
      "navigate",
      {
        url: target.url,
        // Only opt into private-network navigation for hosts that need it, so
        // a typo on a public URL still gets the guard's protection.
        ...(isPrivateHost(target.url) ? { allow_private_network: true } : {}),
      },
      config,
    );

    const navigated = parseNavigate(result.content);
    const view: PageView = await captureView(config, {
      message: target.searched ? `Searched for “${input}”` : null,
    });

    // The snapshot is the authority on where the page settled, but a backend
    // that reports no URL there still gives one on the navigate result.
    return ok({
      ...view,
      url: view.url || navigated.url || target.url,
      title: view.title || navigated.title,
    });
  });
}
