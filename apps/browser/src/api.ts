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

/** One interactive element on the page, addressable by `eid`. */
export interface PageElement {
  eid: string;
  role: string;
  attrs: Record<string, string>;
  value?: string;
  name: string;
}

export interface Screenshot {
  mediaType: string;
  data: string;
}

/** What every page-changing route returns. */
export interface PageView {
  url: string;
  title: string;
  elements: PageElement[];
  screenshot: Screenshot | null;
  screenshotError: string | null;
  message: string | null;
}

export interface BackendStatus {
  mode: string;
  available: boolean;
  autoCandidate: boolean;
  summary: string;
  userActions: string[];
}

export interface BrowserStatus {
  requestedMode: string | null;
  recommendedMode: string | null;
  modes: BackendStatus[];
}

export interface StatusBody {
  session: string;
  mode: string;
  homeUrl: string;
  searchEnabled: boolean;
  backend: BrowserStatus | null;
  backendError: string | null;
}

export interface ExtractBody {
  text: string;
  url: string | null;
}

export interface CloseBody {
  closed: boolean;
  detached: boolean;
  problems: string[];
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
    };

// ── Transport ────────────────────────────────────────────────────────

/**
 * A route that answered with a failure.
 *
 * Routes return `{ error, hint? }`, and the hint is the actionable half — an
 * unresolvable CLI or a disabled search template both come back with the exact
 * `config.json` edit that fixes them — so it survives as its own field rather
 * than being flattened into the message.
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

function toApiError(status: string | number, payload: unknown, fallback: string): ApiError {
  const numeric = typeof status === "number" ? status : 0;
  if (typeof payload === "object" && payload !== null) {
    const body = payload as { error?: unknown; hint?: unknown };
    if (typeof body.error === "string" && body.error !== "") {
      return new ApiError(
        body.error,
        numeric,
        typeof body.hint === "string" ? body.hint : null,
      );
    }
  }
  return new ApiError(fallback, numeric, null);
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
    throw toApiError(
      response.status,
      payload,
      `Request failed (${response.status} ${response.statusText}).`,
    );
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

/** Read settings and backend readiness. The app's first call. */
export function fetchStatus(): Promise<StatusBody> {
  return request<StatusBody>("/status");
}

/** Load a page from raw address-bar input (a URL, a host, or a search phrase). */
export function navigate(input: string): Promise<PageView> {
  return post<PageView>("/navigate", { input });
}

/** Re-read the current page without changing it. */
export function fetchView(fullPage: boolean): Promise<PageView> {
  return request<PageView>(`/view${fullPage ? "?fullPage=1" : ""}`);
}

/** Interact with the page, and get back what it looks like afterwards. */
export function act(action: Action): Promise<PageView> {
  return post<PageView>("/act", action);
}

/** Read the page as text. */
export function fetchText(includeLinks: boolean): Promise<ExtractBody> {
  return request<ExtractBody>(`/extract${includeLinks ? "?includeLinks=1" : ""}`);
}

/** Close the page and release the browser. */
export function closeSession(): Promise<CloseBody> {
  return post<CloseBody>("/close", {});
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
