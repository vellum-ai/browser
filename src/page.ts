/**
 * Parsers for the text the browser operations return.
 *
 * The browser stack is built for a model, so its results are formatted prose:
 * page-derived text arrives wrapped in an `<external_content>` fence, and a
 * snapshot is a line-per-element listing. The app needs structure, so this
 * module turns both into typed data once, here, instead of scattering string
 * handling through the routes and the frontend.
 *
 * Everything parsed here is page-authored, which is exactly why the assistant
 * fenced it. Nothing in this module or the app treats it as instructions: it is
 * rendered as text and used to build operation arguments, never interpreted.
 */

/** One interactive element from a snapshot. */
export interface PageElement {
  /** Snapshot element id (`e7`), the handle interaction operations take. */
  eid: string;
  /** Accessibility role (`button`, `link`, `textbox`, …). */
  role: string;
  /** Attributes the snapshot reported for the element. */
  attrs: Record<string, string>;
  /** Current value, for elements that carry one. */
  value?: string;
  /** Accessible name. */
  name: string;
}

/** The page state a snapshot describes. */
export interface PageSnapshot {
  url: string;
  title: string;
  elements: PageElement[];
}

/**
 * Strip the `<external_content source="web" origin="…">` fence the browser
 * stack wraps page text in, returning the body and the origin it was
 * attributed to. Unfenced input passes through with a null origin.
 */
export function unwrapFence(raw: string): { body: string; origin: string | null } {
  const match = /^<external_content\b([^>]*)>\n?([\s\S]*?)\n?<\/external_content>\s*$/.exec(
    raw.trim(),
  );
  if (!match) {
    return { body: raw.trim(), origin: null };
  }
  const originMatch = /\borigin="([^"]*)"/.exec(match[1] ?? "");
  return {
    body: (match[2] ?? "").trim(),
    origin: originMatch?.[1] ?? null,
  };
}

/**
 * Read a `Key: value` header line out of a fenced body.
 * Returns null when the line is absent or its value is the `(none)` placeholder.
 */
function readHeader(body: string, key: string): string | null {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(body);
  const value = match?.[1]?.trim();
  if (value === undefined || value === "" || value === "(none)") {
    return null;
  }
  return value;
}

/**
 * Parse one `[e3] <role attr="val"> Name` line.
 *
 * Attribute values are page-authored and unescaped, so the tag is scanned with
 * quote awareness rather than matched with `[^>]*` — a `>` inside an attribute
 * value is common enough (`href="?a=1&b=2>3"`, inline SVG names) to matter. A
 * line that stops making sense mid-tag degrades to whatever was parsed so far
 * plus the remainder as the name; it is display data, so a partial read beats
 * dropping the element and its id.
 */
function parseElementLine(line: string): PageElement | null {
  const head = /^\[(e\d+)\]\s+<([^\s>]+)/.exec(line);
  if (!head) {
    return null;
  }
  const eid = head[1] as string;
  const role = head[2] as string;

  const attrs: Record<string, string> = {};
  let i = head[0].length;

  while (i < line.length) {
    while (i < line.length && line[i] === " ") {
      i += 1;
    }
    if (line[i] === ">") {
      i += 1;
      break;
    }

    const eq = line.indexOf('="', i);
    if (eq === -1) {
      // No further well-formed attribute. Resume at the next `>` if there is
      // one so the accessible name is still recovered.
      const close = line.indexOf(">", i);
      i = close === -1 ? line.length : close + 1;
      break;
    }
    const key = line.slice(i, eq);
    const valueStart = eq + 2;
    const valueEnd = line.indexOf('"', valueStart);
    if (valueEnd === -1) {
      i = line.length;
      break;
    }
    attrs[key] = line.slice(valueStart, valueEnd);
    i = valueEnd + 1;
  }

  const element: PageElement = {
    eid,
    role,
    attrs,
    name: line.slice(i).trim(),
  };
  if (attrs.value !== undefined) {
    element.value = attrs.value;
  }
  return element;
}

/**
 * Parse a `snapshot` result into typed page state.
 *
 * `fallbackUrl` covers the case where the snapshot's own `URL:` header is
 * missing — the fence's `origin` attribute names the same page.
 */
export function parseSnapshot(raw: string, fallbackUrl = ""): PageSnapshot {
  const { body, origin } = unwrapFence(raw);

  const elements: PageElement[] = [];
  for (const line of body.split("\n")) {
    const element = parseElementLine(line.trim());
    if (element) {
      elements.push(element);
    }
  }

  return {
    url: readHeader(body, "URL") ?? origin ?? fallbackUrl,
    title: readHeader(body, "Title") ?? "",
    elements,
  };
}

/**
 * Pull the page title and settled URL out of a `navigate` result. Navigate
 * reports `Title: <title>` inside a fence whose origin is the URL it settled
 * on, which is what makes it usable for following redirects.
 */
export function parseNavigate(raw: string): { title: string; url: string | null } {
  const { body, origin } = unwrapFence(raw);
  return { title: readHeader(body, "Title") ?? "", url: origin };
}

/** Page text from an `extract` result, with its fence removed. */
export function parseExtract(raw: string): { text: string; url: string | null } {
  const { body, origin } = unwrapFence(raw);
  return { text: body, url: origin };
}

/** One backend in a `status` result. */
export interface BackendStatus {
  mode: string;
  available: boolean;
  autoCandidate: boolean;
  summary: string;
  userActions: string[];
}

/** Parsed `status` result: which backends can serve a request, and why not. */
export interface BrowserStatus {
  requestedMode: string | null;
  recommendedMode: string | null;
  modes: BackendStatus[];
}

/**
 * Parse a `status` result. Unlike the other operations, status returns a JSON
 * document as its content rather than prose — but it is still the browser
 * stack's payload, so an unexpected shape degrades to "no backends known"
 * rather than throwing.
 */
export function parseStatus(raw: string): BrowserStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { requestedMode: null, recommendedMode: null, modes: [] };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { requestedMode: null, recommendedMode: null, modes: [] };
  }

  const record = parsed as Record<string, unknown>;
  const rawModes = Array.isArray(record.modes) ? record.modes : [];
  const modes: BackendStatus[] = [];

  for (const entry of rawModes) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const mode = entry as Record<string, unknown>;
    if (typeof mode.mode !== "string") {
      continue;
    }
    modes.push({
      mode: mode.mode,
      available: mode.available === true,
      autoCandidate: mode.autoCandidate === true,
      summary: typeof mode.summary === "string" ? mode.summary : "",
      userActions: Array.isArray(mode.userActions)
        ? mode.userActions.filter((a): a is string => typeof a === "string")
        : [],
    });
  }

  return {
    requestedMode: typeof record.requestedMode === "string" ? record.requestedMode : null,
    recommendedMode:
      typeof record.recommendedMode === "string" ? record.recommendedMode : null,
    modes,
  };
}
