/**
 * `POST /x/plugins/browser/close` — end the app's browsing session.
 *
 * Closes the page this session opened and releases the debugger. Both steps are
 * best-effort and reported independently: on the extension backend a detach is
 * what hands the tab back to the user, so a failed close must not stop it from
 * running.
 */

import { runBrowserOperation } from "../src/assistant-cli.js";
import { loadConfig } from "../src/config.js";
import { handle, ok } from "../src/http.js";

export interface CloseBody {
  closed: boolean;
  detached: boolean;
  /** Reasons for whichever step did not succeed. */
  problems: string[];
}

export async function POST(): Promise<Response> {
  return handle(async () => {
    const config = await loadConfig();
    const problems: string[] = [];

    let closed = false;
    try {
      await runBrowserOperation("close", {}, config);
      closed = true;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }

    let detached = false;
    try {
      await runBrowserOperation("detach", {}, config);
      detached = true;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }

    const body: CloseBody = { closed, detached, problems };
    return ok(body);
  });
}
