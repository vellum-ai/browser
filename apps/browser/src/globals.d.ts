/**
 * Ambient declarations for the app bundle: the `window.vellum` bridge the host
 * injects into the sandboxed frame, and the CSS side-effect import esbuild
 * resolves.
 *
 * `@vellumai/plugin-api/app` ships an official declaration of the bridge, but
 * referencing it needs the package installed, and nothing in this repo installs
 * anything — the app is compiled by the assistant's own esbuild pass, which
 * resolves preact and nothing from here. Declaring the two members the app
 * actually uses keeps the source typecheckable on a bare clone.
 *
 * Keep this in sync with the host bridge if the app starts using more of it.
 *
 * This file is a global script, not a module: no imports or exports, so the
 * declarations below augment the global scope directly.
 */

/**
 * Request init the bridge accepts. It serializes the request across
 * `postMessage`, so headers must be a plain object and the body a string —
 * not a `Headers` instance, `FormData`, or a stream.
 */
interface VellumFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

/**
 * The `fetch`-like response the bridge returns. The body arrives as text across
 * the bridge, so only `json()` and `text()` exist — there is no `blob()`.
 */
interface VellumFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface VellumBridge {
  /**
   * Authenticated fetch to this plugin's own routes under `/x/plugins/browser/`
   * (the wrapper prepends the `/v1` API prefix). A bare `fetch` from the
   * sandboxed origin carries neither the gateway URL nor the assistant's
   * session, so it fails.
   */
  fetch(path: string, options?: VellumFetchInit): Promise<VellumFetchResponse>;
  /**
   * Ask the host to act on the app's behalf. `relay_prompt` sends a message to
   * the assistant as if the user had typed it; `set_view` arranges the app and
   * the chat. Optional, because an older host may not inject it.
   */
  sendAction?(action: string, payload: Record<string, unknown>): void;
}

interface Window {
  vellum: VellumBridge;
}

declare module "*.css";
