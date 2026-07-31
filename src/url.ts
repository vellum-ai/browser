/**
 * Turning what someone typed in the address bar into a URL to navigate to.
 *
 * A URL bar accepts three kinds of input — a full URL, a bare host, and a
 * search phrase — and the difference has to be decided before the value
 * reaches the browser stack, which only takes URLs.
 */

import { BrowserCommandError } from "./assistant-cli.js";

/**
 * Schemes the app will navigate to.
 *
 * `javascript:`, `data:`, and `file:` are excluded on purpose: the address bar
 * is reachable from the app's sandboxed frame, and none of those three are
 * things a page-viewing app has any reason to load.
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

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
 * Resolve address-bar input to a navigable URL.
 *
 * A recognized scheme is honored as-is, a bare host is promoted to `https://`,
 * and anything else is handed to the configured search template. When no
 * template is configured, unrecognizable input is an error rather than a guess.
 */
export function resolveTarget(input: string, searchUrlTemplate: string): ResolvedTarget {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new BrowserCommandError("Enter a URL to open.", { status: 400 });
  }

  if (SCHEME_PREFIX.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BrowserCommandError(`\`${trimmed}\` is not a valid URL.`, { status: 400 });
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      throw new BrowserCommandError(
        `This app only opens http and https URLs (got \`${parsed.protocol}\`).`,
        { status: 400 },
      );
    }
    return { url: parsed.toString(), searched: false };
  }

  if (looksLikeHost(trimmed)) {
    return { url: `https://${trimmed}`, searched: false };
  }

  if (searchUrlTemplate === "") {
    throw new BrowserCommandError(`\`${trimmed}\` is not a URL.`, {
      status: 400,
      hint: 'Set "searchUrlTemplate" in the plugin\'s config.json to search from the address bar.',
    });
  }

  const searchUrl = searchUrlTemplate.replace("{query}", encodeURIComponent(trimmed));
  try {
    const parsed = new URL(searchUrl);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      throw new BrowserCommandError(
        'The configured "searchUrlTemplate" is not an http or https URL.',
        { status: 500 },
      );
    }
    return { url: parsed.toString(), searched: true };
  } catch (err) {
    if (err instanceof BrowserCommandError) {
      throw err;
    }
    throw new BrowserCommandError(
      'The configured "searchUrlTemplate" does not produce a valid URL.',
      { status: 500 },
    );
  }
}

/**
 * True when a URL points at loopback or a private range, which the browser
 * stack refuses unless navigation explicitly opts in. Detecting it here lets
 * the route pass `allow_private_network` for exactly those hosts instead of
 * sending it on every navigation.
 */
export function isPrivateHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return true;
  }
  return /^169\.254\./.test(host) || host.endsWith(".local");
}
