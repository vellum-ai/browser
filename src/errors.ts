/**
 * Failure that a route should answer with a specific status and optional hint.
 */

export class BrowserError extends Error {
  /** HTTP status a route should answer with. */
  readonly status: number;
  /** Remediation hint, when there is a concrete next step. */
  readonly hint?: string;

  constructor(message: string, options: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = "BrowserError";
    this.status = options.status ?? 502;
    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }
}
