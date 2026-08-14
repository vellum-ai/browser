/**
 * `GET /x/plugins/browser/extract`: the page as readable text.
 *
 * `?includeLinks=1` appends the page's links. The app no longer shows this;
 * it is for the assistant.
 */

import { ensurePage } from "../src/session.js";
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
