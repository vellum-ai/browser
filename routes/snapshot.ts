/**
 * `GET /x/plugins/browser/snapshot`: interactive elements on the current page.
 *
 * For the assistant. The app paints a live picture and does not list elements.
 * Ids are valid until the next snapshot.
 */

import { handle, ok } from "../src/http.js";
import { exclusive } from "../src/lock.js";
import { ensurePage } from "../src/session.js";
import { collectSnapshot } from "../src/snapshot.js";
import type { PageSnapshot } from "../src/snapshot.js";

export async function GET(): Promise<Response> {
  return handle(async () => {
    return exclusive(async () => {
      const page = await ensurePage();
      const body: PageSnapshot = await collectSnapshot(page);
      return ok(body);
    });
  });
}
