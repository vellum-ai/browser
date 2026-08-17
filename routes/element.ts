/**
 * `POST /x/plugins/browser/element`: click or type into a snapshotted element.
 *
 * Body: `{ action: "click" | "type", eid, text? }`. `eid` comes from the last
 * `GET /snapshot`. A stale id fails instead of hitting a different node.
 */

import { BrowserError } from "../src/errors.js";
import { handle, ok, readJson, requireString } from "../src/http.js";
import { exclusive } from "../src/lock.js";
import { ensurePage } from "../src/session.js";
import { elementLocator } from "../src/snapshot.js";
import { pageIdentity } from "../src/view.js";
import type { PageIdentity } from "../src/view.js";

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const action = requireString(body, "action");
    const eid = requireString(body, "eid");

    return exclusive(async () => {
      const page = await ensurePage();
      const locator = elementLocator(page, eid);
      const count = await locator.count();
      if (count === 0) {
        throw new BrowserError(
          `Element \`${eid}\` is gone. Take a new snapshot.`,
          { status: 404 },
        );
      }

      if (action === "click") {
        await locator.click({ timeout: 10_000 });
      } else if (action === "type") {
        const text = requireString(body, "text");
        await locator.fill(text, { timeout: 10_000 });
      } else {
        throw new BrowserError(
          `Unsupported action \`${action}\`. Expected click or type.`,
          { status: 400 },
        );
      }

      const identity: PageIdentity = await pageIdentity(page, null);
      return ok(identity);
    });
  });
}
