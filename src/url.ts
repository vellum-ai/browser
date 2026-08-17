/**
 * Turning what someone typed in the address bar into a URL to navigate to.
 *
 * A URL bar accepts three kinds of input — a full URL, a bare host, and a
 * search phrase — and the difference has to be decided before the value reaches
 * the browser, which only takes URLs.
 */

import { BrowserError } from "./errors.js";

/**
 * Schemes the app will navigate to.
 *
 * `javascript:`, `data:`, and `file:` are excluded on purpose: the address bar
 * is reachable from the app's sandboxed frame, and none of the three are things
 * a page-viewing app has any reason to load. `file:` in particular would hand
 * the frame a reader for the machine's local disk.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Where a search phrase goes.
 *
 * A constant rather than a setting: the plugin ships no configuration, and an
 * address bar that silently refuses everything but URLs is worse than one with
 * an opinion. DuckDuckGo needs no account and sets no cross-site identity.
 */
const SEARCH_URL = "https://duckduckgo.com/?q=";

/**
 * Input that opens with a scheme (`https:`, `ftp:`, `javascript:`).
 *
 * The trailing lookahead is what keeps `localhost:3000` and `example.com:8080`
 * out: a colon followed by digits is a port, and reading it as a scheme would
 * send every `host:port` address down the "unsupported scheme" path.
 */
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** Looks like a hostname (`example.com`, `localhost:3000`) rather than a phrase. */
function looksLikeHost(input: string): boolean {
  if (/\s/.test(input)) {
    return false;
  }
  const host = input.split("/")[0] ?? "";
  return /^localhost(:\d+)?$/i.test(host) || /^[\w-]+(\.[\w-]+)+(:\d+)?$/.test(host);
}

export interface ResolvedTarget {
  /** The URL to navigate to. */
  url: string;
  /** True when the input was treated as a search phrase, not a URL. */
  searched: boolean;
}

/**
 * Resolve address-bar input to a navigable URL. A recognized scheme is honored
 * as-is, a bare host is promoted to `https://`, and anything else is searched.
 */
export function resolveTarget(input: string): ResolvedTarget {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new BrowserError("Enter a URL to open.", { status: 400 });
  }

  if (SCHEME_PREFIX.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BrowserError(`\`${trimmed}\` is not a valid URL.`, { status: 400 });
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      throw new BrowserError(
        `This app only opens http and https URLs (got \`${parsed.protocol}\`).`,
        { status: 400 },
      );
    }
    return { url: parsed.toString(), searched: false };
  }

  if (looksLikeHost(trimmed)) {
    return { url: `https://${trimmed}`, searched: false };
  }

  return { url: `${SEARCH_URL}${encodeURIComponent(trimmed)}`, searched: true };
}
