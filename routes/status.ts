/**
 * `GET /x/plugins/browser/status` — the app's bootstrap call.
 *
 * Returns the settings the app needs to render its first frame plus which
 * browser backends can actually serve a request. The app opens on this rather
 * than on a navigation, so a missing extension or an unreachable backend is
 * reported as guidance instead of surfacing later as a failed click.
 */

import { runBrowserOperation } from "../src/assistant-cli.js";
import { loadConfig } from "../src/config.js";
import type { BrowserMode } from "../src/config.js";
import { handle, ok } from "../src/http.js";
import { parseStatus } from "../src/page.js";
import type { BrowserStatus } from "../src/page.js";

export interface StatusBody {
  session: string;
  mode: BrowserMode;
  homeUrl: string;
  searchEnabled: boolean;
  /** Null when the status probe itself failed; `backendError` says why. */
  backend: BrowserStatus | null;
  backendError: string | null;
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    const config = await loadConfig();

    let backend: BrowserStatus | null = null;
    let backendError: string | null = null;
    try {
      const result = await runBrowserOperation("status", {}, config);
      backend = parseStatus(result.content);
    } catch (err) {
      // A failed probe must not block the app from opening — it renders the
      // reason in its banner and still lets the user try a navigation, which
      // is often how a backend gets provisioned in the first place.
      backendError = err instanceof Error ? err.message : String(err);
    }

    const body: StatusBody = {
      session: config.sessionId,
      mode: config.browserMode,
      homeUrl: config.homeUrl,
      searchEnabled: config.searchUrlTemplate !== "",
      backend,
      backendError,
    };
    return ok(body);
  });
}
