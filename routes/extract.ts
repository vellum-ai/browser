/**
 * `GET /x/plugins/browser/extract` — the page as readable text.
 *
 * Backs the app's Text tab, which is what makes a screenshot-based browser
 * usable for actually reading a page: selectable, scrollable, searchable with
 * the panel's own find. `?includeLinks=1` appends the page's links.
 */

import { loadConfig } from "../src/config.js";
import { boolParam, handle, ok } from "../src/http.js";
import { runBrowserOperation } from "../src/assistant-cli.js";
import { parseExtract } from "../src/page.js";

export interface ExtractBody {
  text: string;
  url: string | null;
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const config = await loadConfig();
    const includeLinks = boolParam(request, "includeLinks");
    const result = await runBrowserOperation(
      "extract",
      includeLinks ? { include_links: true } : {},
      config,
    );
    const body: ExtractBody = parseExtract(result.content);
    return ok(body);
  });
}
