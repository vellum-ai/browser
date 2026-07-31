/**
 * Thin wrapper around `assistant browser --json <operation>`.
 *
 * The plugin drives the assistant's own browser stack rather than shipping a
 * second one, and the `assistant browser` CLI is the supported contract for
 * reaching it (`@vellumai/plugin-api` exposes no browser handle). The CLI
 * itself only marshals the call onto the daemon's IPC socket, so a route
 * running inside the daemon pays one short-lived subprocess per operation and
 * gets the same execution path a skill would.
 *
 * Two deliberate choices about identity:
 *
 * - **No conversation id.** With no `__CONVERSATION_ID` in the environment the
 *   daemon derives the browser context key from the session id alone, so the
 *   app's pages, cookies, and snapshot element map are keyed to its own
 *   session and never bind to whatever conversation happens to be open. The
 *   inherited daemon environment is scrubbed of both conversation variables so
 *   this cannot happen by accident.
 * - **Session from config.** Every call carries `--session`, so the app's
 *   browsing is isolated from the `default` session the model drives.
 */

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { BrowserAppConfig } from "./config.js";

const execFileAsync = promisify(execFile);

/**
 * Screenshots come back as base64 JPEG on stdout, so the default 1 MB
 * `maxBuffer` is far too small for a full-page capture.
 */
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

/** Operations this plugin is willing to invoke. */
export const SUPPORTED_OPERATIONS = [
  "navigate",
  "snapshot",
  "screenshot",
  "extract",
  "click",
  "type",
  "press-key",
  "scroll",
  "select-option",
  "hover",
  "wait-for",
  "close",
  "detach",
  "status",
] as const;

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];

/**
 * `fill-credential` is intentionally absent. It reaches into the credential
 * vault, and a browser app driven by clicks in a panel is not a place to put
 * that behind an unauthenticated-looking button — the model asks for it
 * through its own tools, where the approval path applies.
 */
export function isSupportedOperation(value: unknown): value is SupportedOperation {
  return (
    typeof value === "string" &&
    (SUPPORTED_OPERATIONS as readonly string[]).includes(value)
  );
}

/** A single screenshot returned in the CLI's JSON envelope. */
export interface CliScreenshot {
  mediaType: string;
  data: string;
}

/** The `--json` envelope on success. */
export interface BrowserCommandResult {
  content: string;
  screenshots: CliScreenshot[];
}

/** Raised for anything that stops an operation from producing a result. */
export class BrowserCommandError extends Error {
  /** HTTP status a route should answer with. */
  readonly status: number;
  /** Remediation hint, when there is a concrete next step. */
  readonly hint?: string;

  constructor(message: string, options: { status?: number; hint?: string } = {}) {
    super(message);
    this.name = "BrowserCommandError";
    this.status = options.status ?? 502;
    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }
}

// ── Binary resolution ────────────────────────────────────────────────

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidate locations for the CLI, best first.
 *
 * In the packaged desktop app the daemon runs from a compiled binary and the
 * `vellum-assistant` CLI binary is its sibling, which is the most reliable
 * answer available. The two symlink locations the daemon installs on startup
 * come next, and a bare `assistant` (resolved from PATH by the OS) is the last
 * resort for installs that manage their own PATH.
 */
function candidateBinaries(configured: string): string[] {
  const candidates: string[] = [];
  if (configured !== "") {
    candidates.push(configured);
  }
  candidates.push(join(dirname(process.execPath), "vellum-assistant"));
  candidates.push("/usr/local/bin/assistant");
  candidates.push(join(homedir(), ".local", "bin", "assistant"));
  return candidates;
}

let resolvedBin: string | null = null;

/**
 * Resolve the CLI path, memoizing the answer. The memo is dropped when the
 * resolved path stops being executable (an upgrade moved the binary), so a
 * long-lived daemon re-resolves instead of failing every request.
 */
export function resolveAssistantBin(config: BrowserAppConfig): string {
  if (resolvedBin !== null && (resolvedBin === "assistant" || isExecutable(resolvedBin))) {
    return resolvedBin;
  }

  for (const candidate of candidateBinaries(config.assistantBin)) {
    if (isExecutable(candidate)) {
      resolvedBin = candidate;
      return candidate;
    }
  }

  // Nothing on disk matched. Fall through to PATH resolution and let the spawn
  // failure carry the diagnostic — probing PATH here would just duplicate it.
  resolvedBin = "assistant";
  return resolvedBin;
}

/** Drop the memoized binary path. Exported for the `init` hook and tests. */
export function resetBinCache(): void {
  resolvedBin = null;
}

/**
 * True when auto-detection found a real binary on disk. The `init` hook uses
 * this to warn at boot instead of leaving the first click to discover it.
 */
export function hasResolvableBin(config: BrowserAppConfig): boolean {
  return candidateBinaries(config.assistantBin).some(isExecutable);
}

// ── Invocation ───────────────────────────────────────────────────────

/**
 * Environment for the CLI child.
 *
 * The daemon's environment carries everything the CLI needs to find the IPC
 * socket and workspace, so it is inherited wholesale — minus the two variables
 * that would bind this call to a conversation (see the module comment).
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.__CONVERSATION_ID;
  delete env.__SKILL_CONTEXT_JSON;
  return env;
}

/** Render an operation's input object as CLI flags. */
function toFlags(input: Record<string, unknown>): string[] {
  const flags: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    const flag = `--${key.replace(/_/g, "-")}`;
    if (typeof value === "boolean") {
      // Commander's boolean options take no value; `--no-<flag>` is how the
      // CLI spells an explicit false (e.g. `--no-clear-first`).
      flags.push(value ? flag : `--no-${key.replace(/_/g, "-")}`);
      continue;
    }
    flags.push(flag, String(value));
  }
  return flags;
}

interface CliEnvelope {
  ok?: unknown;
  content?: unknown;
  error?: unknown;
  screenshots?: unknown;
}

function parseScreenshots(raw: unknown): CliScreenshot[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const shots: CliScreenshot[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { mediaType, data } = entry as Record<string, unknown>;
    if (typeof mediaType === "string" && typeof data === "string") {
      shots.push({ mediaType, data });
    }
  }
  return shots;
}

/**
 * Run one browser operation and return its parsed envelope.
 *
 * The CLI exits non-zero for an operation-level failure and still prints the
 * `{"ok":false,"error":…}` envelope on stdout, so stdout is parsed before the
 * exit code is judged — the page-level reason ("no element with id e7") is far
 * more useful than "exited 1".
 */
export async function runBrowserOperation(
  operation: SupportedOperation,
  input: Record<string, unknown>,
  config: BrowserAppConfig,
): Promise<BrowserCommandResult> {
  const bin = resolveAssistantBin(config);
  const args = [
    "browser",
    "--json",
    "--session",
    config.sessionId,
    ...(config.browserMode === "auto" ? [] : ["--browser-mode", config.browserMode]),
    operation,
    ...toFlags(input),
  ];

  let stdout: string;
  try {
    const result = await execFileAsync(bin, args, {
      env: childEnv(),
      timeout: config.commandTimeoutMs,
      maxBuffer: MAX_STDOUT_BYTES,
      encoding: "utf-8",
    });
    stdout = result.stdout;
  } catch (err) {
    const failure = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    if (failure.code === "ENOENT") {
      throw new BrowserCommandError(
        `Could not find the \`assistant\` CLI (tried \`${bin}\`).`,
        {
          status: 503,
          hint: 'Set "assistantBin" in the plugin\'s config.json to the absolute path of the assistant binary.',
        },
      );
    }
    if (failure.killed === true) {
      throw new BrowserCommandError(
        `\`assistant browser ${operation}\` timed out after ${config.commandTimeoutMs}ms.`,
        {
          status: 504,
          hint: 'Raise "commandTimeoutMs" in config.json if the page is simply slow.',
        },
      );
    }

    // Non-zero exit: the envelope on stdout is the real answer.
    stdout = failure.stdout ?? "";
    if (stdout.trim() === "") {
      const stderr = (failure.stderr ?? "").trim();
      throw new BrowserCommandError(
        stderr === "" ? `\`assistant browser ${operation}\` failed.` : stderr,
      );
    }
  }

  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(stdout.trim()) as CliEnvelope;
  } catch {
    throw new BrowserCommandError(
      `\`assistant browser ${operation}\` returned output that is not JSON.`,
    );
  }

  if (envelope.ok !== true) {
    const reason =
      typeof envelope.error === "string" && envelope.error.trim() !== ""
        ? envelope.error
        : `\`assistant browser ${operation}\` reported a failure.`;
    throw new BrowserCommandError(reason, { status: 502 });
  }

  return {
    content: typeof envelope.content === "string" ? envelope.content : "",
    screenshots: parseScreenshots(envelope.screenshots),
  };
}
