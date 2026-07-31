/**
 * The app's client for this plugin's routes.
 *
 * The wire types mirror the route modules under `<pluginDir>/routes/`. They are
 * declared here rather than imported because the app compiles as its own bundle
 * and cannot reach outside its directory — so this file is the contract's
 * app-side half, and the two move together.
 */

const BASE = "/x/plugins/browser";

// ── Wire types ───────────────────────────────────────────────────────

/** A rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One interactive element on the page, addressable by `eid`. */
export interface PageElement {
  eid: string;
  role: string;
  name: string;
  attrs: Record<string, string>;
  value?: string;
  /** Position in the viewport — where to draw a box on a viewport capture. */
  rect: Rect;
  /** Position in the document — the same, for a full-page capture. */
  pageRect: Rect;
}

/** What every page-touching route returns. */
export interface PageView {
  url: string;
  title: string;
  elements: PageElement[];
  /** Base64 JPEG, or null when the capture failed. */
  screenshot: string | null;
  screenshotError: string | null;
  fullPage: boolean;
  /** Size of the capture in CSS pixels, for mapping element boxes onto it. */
  capture: { width: number; height: number };
  scroll: { x: number; y: number };
  message: string | null;
}

export type BrowserSource =
  | "system-chrome"
  | "chrome-for-testing"
  | "bundled-chromium"
  | "none";

export interface StatusBody {
  running: boolean;
  starting: boolean;
  source: BrowserSource;
  /** Why the last launch failed, when one did. Drives the retry state. */
  error: { message: string; hint: string | null } | null;
}

export interface ExtractBody {
  text: string;
  url: string;
}

/** Every action the `act` route accepts, with its arguments. */
export type Action =
  | { action: "click" | "hover"; elementId: string }
  | {
      action: "type";
      elementId: string;
      text: string;
      pressEnter?: boolean;
      clearFirst?: boolean;
    }
  | { action: "press-key"; key: string; elementId?: string }
  | { action: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number }
  | {
      action: "select-option";
      elementId: string;
      value?: string;
      label?: string;
      index?: number;
    }
  | { action: "click-at"; x: number; y: number }
  | { action: "back" | "forward" | "reload" };

// ── Transport ────────────────────────────────────────────────────────

/**
 * A route that answered with a failure.
 *
 * Routes return `{ error, hint? }`, and the hint is the actionable half — a
 * stale element id comes back with "reload the page", a missing Chromium with
 * the command that installs it — so it survives as its own field rather than
 * being flattened into the message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly hint: string | null;

  constructor(message: string, status: number, hint: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.hint = hint;
  }
}

/**
 * Turn a failed response into an error worth reading.
 *
 * A body with an `error` field came from this plugin's routes and already says
 * what went wrong. A body without one did not: the assistant's route dispatcher
 * answers 500 on its own when a route module cannot be imported or throws
 * outside its handler, and that response carries no message. Rendering the bare
 * status there produced "Request failed (500 )." — technically true and no help
 * at all — so that case names where to look instead.
 */
function toApiError(status: number, statusText: string, payload: unknown): ApiError {
  if (typeof payload === "object" && payload !== null) {
    const body = payload as { error?: unknown; hint?: unknown };
    if (typeof body.error === "string" && body.error !== "") {
      return new ApiError(body.error, status, typeof body.hint === "string" ? body.hint : null);
    }
  }

  if (status >= 500) {
    return new ApiError(
      "The browser plugin did not respond.",
      status,
      "The assistant's log has the plugin's own error — check it with `assistant logs`, and `assistant plugins list` for the plugin's load status.",
    );
  }

  const detail = statusText.trim() === "" ? `${status}` : `${status} ${statusText.trim()}`;
  return new ApiError(`Request failed (${detail}).`, status, null);
}

async function request<T>(path: string, init?: VellumFetchInit): Promise<T> {
  let response: VellumFetchResponse;
  try {
    response = await window.vellum.fetch(`${BASE}${path}`, init);
  } catch (err) {
    // The bridge itself failed — the host did not deliver the request at all.
    throw new ApiError(
      err instanceof Error ? err.message : "The assistant could not be reached.",
      0,
      null,
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Leave payload null; the status line below carries the reason.
  }

  if (!response.ok) {
    throw toApiError(response.status, response.statusText, payload);
  }
  return payload as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Operations ───────────────────────────────────────────────────────

/** Whether the browser is up, and which Chromium backs it. The first call. */
export function fetchStatus(): Promise<StatusBody> {
  return request<StatusBody>("/status");
}

/**
 * Start the browser, or retry after a failed launch. Answers with the same
 * shape as `/status`, so a failure comes back as state to render rather than as
 * a thrown error.
 */
export function startBrowser(): Promise<StatusBody> {
  return post<StatusBody>("/start", {});
}

/** Load a page from raw address-bar input (a URL, a host, or a search phrase). */
export function navigate(input: string, fullPage: boolean): Promise<PageView> {
  return post<PageView>("/navigate", { input, fullPage });
}

/** Re-read the current page without changing it. */
export function fetchView(fullPage: boolean): Promise<PageView> {
  return request<PageView>(`/view${fullPage ? "?fullPage=1" : ""}`);
}

/** Interact with the page, and get back what it looks like afterwards. */
export function act(action: Action, fullPage: boolean): Promise<PageView> {
  return post<PageView>("/act", { ...action, fullPage });
}

/** Read the page as text. */
export function fetchText(includeLinks: boolean): Promise<ExtractBody> {
  return request<ExtractBody>(`/extract${includeLinks ? "?includeLinks=1" : ""}`);
}

/** Shut the browser down. The profile survives, so logins do too. */
export function closeBrowser(): Promise<{ closed: true }> {
  return post<{ closed: true }>("/close", {});
}

/**
 * Hand a prompt to the assistant as if the user had typed it. Returns false
 * when the host did not inject `sendAction`, so callers can hide the affordance
 * rather than offering a button that does nothing.
 */
export function relayPrompt(prompt: string): boolean {
  const send = window.vellum.sendAction;
  if (typeof send !== "function") {
    return false;
  }
  send.call(window.vellum, "relay_prompt", { prompt });
  return true;
}

/** True when the host supports relaying prompts. */
export function canRelayPrompt(): boolean {
  return typeof window.vellum.sendAction === "function";
}
