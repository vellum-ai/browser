/**
 * `GET /x/plugins/browser/status` — the app's bootstrap call.
 *
 * Reports whether the browser is up, which Chromium backs it, and why the last
 * launch failed if one did. That last field is what lets the app show a real
 * error with a retry instead of a spinner that never resolves.
 *
 * Read-only: it never launches. `init` installs Chromium, the app opens the
 * window on load via `POST /start`, and that same route is the explicit retry.
 * A GET that could trigger a multi-minute download would be a poor bootstrap
 * call.
 */

import { handle, ok } from "../src/http.js";
import { buildStatus } from "../src/status.js";

export async function GET(): Promise<Response> {
  return handle(async () => ok(buildStatus()));
}
