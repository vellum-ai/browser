/**
 * `POST /x/plugins/browser/start`: start the browser, or try again.
 *
 * Backs the app's load path and its Start / Retry button. `init` installs
 * Chromium at boot but does not open a window. The app calls this when it
 * opens, and again if that launch fails or the user closed the browser. A
 * boot-time install failure is not permanent: a machine can gain a Chromium, a
 * download can succeed on a second attempt, a transient launch error can clear,
 * and without an explicit retry the only way back would be restarting the
 * assistant.
 *
 * Answers with the same shape as `/status` either way. A failed start is not an
 * error response: the app renders the reason out of the status body, and a 500
 * here would just be a second thing for it to handle.
 */

import { ensureContext } from "../src/browser.js";
import { handle, ok } from "../src/http.js";
import { buildStatus } from "../src/status.js";
import type { StatusBody } from "../src/status.js";

export async function POST(): Promise<Response> {
  return handle(async () => {
    try {
      await ensureContext();
    } catch {
      // The reason is recorded on the module and comes back in the status body
      // below, which is the one place the app reads it from.
    }
    const body: StatusBody = buildStatus();
    return ok(body);
  });
}
