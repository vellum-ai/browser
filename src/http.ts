/**
 * Response helpers shared by the plugin's routes.
 *
 * Every route answers the app, and the app renders whatever comes back, so the
 * error shape matters as much as the success shape: a failure carries a
 * human-readable reason and, where one exists, the concrete next step.
 */

import { BrowserError } from "./browser.js";

/** The error body every failing route returns. */
export interface ErrorBody {
  error: string;
  hint?: string;
}

/** Answer with JSON. */
export function ok<T>(body: T, status = 200): Response {
  return Response.json(body, { status });
}

/** Answer with a failure the app can render. */
export function fail(error: string, status = 400, hint?: string): Response {
  const body: ErrorBody = { error };
  if (hint !== undefined) {
    body.hint = hint;
  }
  return Response.json(body, { status });
}

/**
 * Run a route body, mapping a thrown error to a response.
 *
 * `BrowserError` already carries the status and hint it wants. Anything
 * else is a bug in this plugin, so it answers 500 with its message rather than
 * letting the dispatcher return a bare 500 with no attribution.
 */
export async function handle(body: () => Promise<Response>): Promise<Response> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof BrowserError) {
      return fail(err.message, err.status, err.hint);
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail(message, 500);
  }
}

/** Parse a JSON request body, treating an empty or malformed body as `{}`. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

/** Read a required non-empty string field, or fail with a 400. */
export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new BrowserError(`\`${field}\` is required.`, { status: 400 });
  }
  return value;
}

/** Read an optional non-empty string field. */
export function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Read an optional finite number field. */
export function optionalNumber(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = body[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Read a required finite number field, or fail with a 400. */
export function requireNumber(
  body: Record<string, unknown>,
  field: string,
): number {
  const value = optionalNumber(body, field);
  if (value === undefined) {
    throw new BrowserError(`\`${field}\` is required.`, { status: 400 });
  }
  return value;
}

/** Read a boolean query parameter (`?includeLinks=1`). */
export function boolParam(request: Request, name: string): boolean {
  const value = new URL(request.url).searchParams.get(name);
  return value === "1" || value === "true";
}
