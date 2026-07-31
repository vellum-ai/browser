/**
 * `GET /x/plugins/browser/extract` — the page as readable text.
 *
 * Backs the app's Text tab, which is what makes a capture-based browser usable
 * for actually reading a page: selectable, scrollable, and searchable with the
 * panel's own find. `?includeLinks=1` appends the page's links.
 */

import { ensurePage } from "../src/browser.js";
import { boolParam, handle, ok } from "../src/http.js";
import { extractText } from "../src/snapshot.js";

export interface ExtractBody {
  text: string;
  url: string;
}

export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const page = await ensurePage();
    const body: ExtractBody = await extractText(page, boolParam(request, "includeLinks"));
    return ok(body);
  });
}
