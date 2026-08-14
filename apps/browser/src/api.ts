/**
 * The app's client for this plugin's routes.
 *
 * The wire types mirror the route modules under `<pluginDir>/routes/`. They are
 * declared here rather than imported because the app compiles as its own bundle
 * and cannot reach outside its directory, so this file is the contract's
 * app-side half, and the two move together.
 */

const BASE = "/x/plugins/browser";

// ── Wire types ───────────────────────────────────────────────────────

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

export interface PageIdentity {
  url: string;
  title: string;
  message: string | null;
}

export interface FrameBody {
  screenshot: string | null;
  width: number;
  height: number;
  url: string;
  title: string;
  seq: number;
}

export type HistoryAction = "back" | "forward" | "reload";

export type PointerButton = "left" | "right" | "middle";

export type Input =
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "move"; x: number; y: number }
  | { type: "down"; x: number; y: number; button?: PointerButton; count?: number }
  | { type: "up"; x: number; y: number; button?: PointerButton }
  | { type: "click"; x: number; y: number; button?: PointerButton; count?: number }
  | { type: "key"; key: string }
  | { type: "resize"; width: number; height: number };

// ── Transport ────────────────────────────────────────────────────────

/**
 * A route that answered with a failure.
 *
 * Routes return `{ error, hint? }`, and the hint is the actionable half: a
 * missing Chromium comes back with the command that installs it, so it survives
 * as its own field rather than being flattened into the message.
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
 * status there produced "Request failed (500 )." which is technically true and
 * no help at all, so that case names where to look instead.
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
      "The assistant's log has the plugin's own error. Check it with `assistant logs`, and `assistant plugins list` for the plugin's load status.",
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
 * Open the Chromium window, or retry after a failed launch. Answers with the
 * same shape as `/status`, so a failure comes back as state to render rather
 * than as a thrown error.
 */
export function startBrowser(): Promise<StatusBody> {
  return post<StatusBody>("/start", {});
}

/** Load a page from raw address-bar input (a URL, a host, or a search phrase). */
export function navigate(input: string): Promise<PageIdentity> {
  return post<PageIdentity>("/navigate", { input });
}

let paintedSeq = 0;

function notePaintedSeq(seq: number): void {
  if (seq > paintedSeq) {
    paintedSeq = seq;
  }
}

/** The latest live picture of the page. `since` is the last seq the canvas painted. */
export function fetchFrame(since = paintedSeq): Promise<FrameBody> {
  return request<FrameBody>(`/frame?since=${since}`).then((body) => {
    if (typeof body.seq === "number") {
      notePaintedSeq(body.seq);
    }
    return body;
  });
}

export interface Caret {
  x: number;
  y: number;
  height: number;
}

export interface InputResult {
  ok: true;
  width: number;
  height: number;
  cursor?: string;
  caret?: Caret | null;
  href?: string | null;
  screenshot?: string | null;
  seq?: number;
  url?: string;
  title?: string;
}

/**
 * Pointer, wheel, keyboard, or a panel resize.
 *
 * Moves and wheels queue and flush as one POST. A down, up, key, or resize
 * flushes immediately, including anything already queued, so a click is never
 * stuck behind a trail of moves. The host bridge is one HTTP request per
 * `postMessage`, which is why a mouse tick must not be its own round trip.
 */
let queue: Input[] = [];
let waiters: Array<{
  resolve: (result: InputResult) => void;
  reject: (error: unknown) => void;
}> = [];
let running = false;
let scheduled = false;

function compact(events: Input[]): Input[] {
  const out: Input[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    if (event.type === "move" && last?.type === "move") {
      out[out.length - 1] = event;
      continue;
    }
    if (event.type === "wheel" && last?.type === "wheel") {
      out[out.length - 1] = {
        type: "wheel",
        x: event.x,
        y: event.y,
        deltaX: last.deltaX + event.deltaX,
        deltaY: last.deltaY + event.deltaY,
      };
      continue;
    }
    out.push(event);
  }
  return out;
}

function isUrgent(input: Input): boolean {
  return input.type !== "move" && input.type !== "wheel";
}

async function pump(): Promise<void> {
  scheduled = false;
  if (running) {
    return;
  }
  running = true;
  while (queue.length > 0) {
    const events = compact(queue);
    const batch = waiters;
    queue = [];
    waiters = [];
    try {
      const result = await post<InputResult>("/input", { events, since: paintedSeq });
      if (typeof result.seq === "number") {
        notePaintedSeq(result.seq);
      }
      for (const waiter of batch) {
        waiter.resolve(result);
      }
    } catch (error) {
      for (const waiter of batch) {
        waiter.reject(error);
      }
    }
  }
  running = false;
  if (queue.length > 0) {
    void pump();
  }
}

export function sendInput(input: Input): Promise<InputResult> {
  const pending = new Promise<InputResult>((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
  queue.push(input);
  if (isUrgent(input)) {
    void pump();
    return pending;
  }
  if (!scheduled && !running) {
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      void pump();
    });
  }
  return pending;
}

/** Back, forward, or reload. */
export function act(action: HistoryAction): Promise<PageIdentity> {
  return post<PageIdentity>("/act", { action });
}

