/**
 * The plugin's browser: one Playwright Chromium, launched once and held.
 *
 * Playwright is a direct dependency and is driven in-process. That makes the
 * page a live object rather than something addressed one subprocess at a time,
 * which is what lets the app offer real history navigation and clicks at a
 * coordinate — both of which the page simply has, and neither of which survives
 * being marshalled through a command per step.
 *
 * ## Lifecycle
 *
 * The context is a module singleton because the plugin is one browser, not one
 * per request: routes and hooks import this module by the same specifier, so
 * they share the instance. `init` installs Chromium at boot (download only) and
 * `shutdown` closes a running context. The window itself opens when the app
 * loads, via `POST /start`. {@link ensureContext} is still lazy and single-flight,
 * so a request that lands before that start settles waits for the same launch
 * instead of starting a second one.
 *
 * ## Getting a browser to launch
 *
 * A plugin's dependencies are installed with `--ignore-scripts`, so Playwright's
 * own postinstall never runs and its browser binaries are absent on a fresh
 * install. Resolution therefore mirrors what the assistant does for its own
 * local backend: prefer a system Chrome, otherwise install Chrome for Testing on
 * demand, and fall back to Chrome for Testing if the system copy will not start.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext } from "playwright";
import { chromium } from "playwright";

import { DEFAULT_VIEWPORT, stopScreencast } from "./screencast.js";

/** How long the on-demand Chrome for Testing download is allowed to take. */
const BROWSER_INSTALL_TIMEOUT_MS = 300_000;

/**
 * This module sits at `<pluginDir>/src/browser.ts`, so the plugin root is two
 * levels up. Resolved from the module's own URL rather than the process CWD,
 * which belongs to the daemon.
 */
const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The browser profile lives under the plugin's `data/` directory — the one
 * place a plugin owns durable state, and the reason logins survive a restart.
 * Removing the plugin removes the profile with it.
 */
const PROFILE_DIR = join(PLUGIN_DIR, "data", "profile");

/** Raised for anything that stops an operation from producing a result. */
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

// ── Chrome resolution ────────────────────────────────────────────────

/** Where the Chromium being driven came from. */
export type BrowserSource =
  /** Google Chrome, already installed on this machine. */
  | "system-chrome"
  /** Playwright's own build, at the revision this package pins. */
  | "chrome-for-testing"
  /** A standalone Chromium the image ships, outside Playwright's registry. */
  | "bundled-chromium"
  /** Nothing yet — the next launch downloads Chrome for Testing. */
  | "none";

/**
 * Chromium builds that live outside Playwright's registry.
 *
 * Playwright resolves its browser by exact revision (`chromium-1208/...`), so a
 * perfectly good Chromium sitting at a plain path is invisible to it. Container
 * images routinely ship exactly that, and driving one is far better than
 * downloading a second copy of the same browser.
 */
const STANDALONE_CHROMIUM = [
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

/** A Google Chrome already installed on this machine, if there is one. */
function findSystemChrome(): string | null {
  const candidates: string[] = [];

  if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    candidates.push(
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    );
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable");
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Whether the host can show a browser window, or must run headless. */
function canDisplayGui(): boolean {
  if (process.platform === "darwin" || process.platform === "win32") {
    return true;
  }
  return Boolean(process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY);
}

/** Playwright's own Chromium build, at the revision this package pins. */
function findChromeForTesting(): string | null {
  try {
    const path = chromium.executablePath();
    return existsSync(path) ? path : null;
  } catch {
    // executablePath() throws when the browser registry is missing entirely.
    return null;
  }
}

/** What this machine can launch right now, best first. */
export function resolveBrowser(): { executablePath: string | null; source: BrowserSource } {
  const systemChrome = findSystemChrome();
  if (systemChrome !== null) {
    return { executablePath: systemChrome, source: "system-chrome" };
  }
  // Playwright resolves its own build itself, so this deliberately reports no
  // explicit path — passing one would pin the launch to a copy Playwright is
  // already responsible for locating.
  if (findChromeForTesting() !== null) {
    return { executablePath: null, source: "chrome-for-testing" };
  }
  const standalone = STANDALONE_CHROMIUM.find((candidate) => existsSync(candidate));
  if (standalone !== undefined) {
    return { executablePath: standalone, source: "bundled-chromium" };
  }
  return { executablePath: null, source: "none" };
}

/**
 * A JS runtime that can execute Playwright's CLI.
 *
 * `process.execPath` is the daemon, which in a packaged install is the compiled
 * assistant binary and cannot run a script — so it is used only when it really
 * is a JS runtime, and PATH is consulted otherwise.
 */
function findRunner(): string | null {
  const own = process.execPath;
  const name = own.slice(own.lastIndexOf("/") + 1);
  if (name === "bun" || name === "node") {
    return own;
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    for (const candidate of ["bun", "node"]) {
      if (dir !== "" && existsSync(join(dir, candidate))) {
        return join(dir, candidate);
      }
    }
  }
  return null;
}

/**
 * Download Chrome for Testing.
 *
 * Reached when nothing else on the machine can be driven, because a plugin
 * installs with `--ignore-scripts` and Playwright's own postinstall never runs.
 *
 * This invokes **this plugin's** Playwright CLI by absolute path, rather than
 * `bunx playwright`. `bunx` resolves against the working directory, which
 * belongs to the daemon and not to the plugin, so it would miss the copy in
 * `node_modules/` and fetch whatever version the registry serves — which
 * downloads a browser at *that* version's revision while `executablePath()`
 * keeps pointing at the revision this package pins. The install appears to
 * succeed and the browser is still missing.
 *
 * `--with-deps` is also deliberately absent: it shells out to the system
 * package manager and needs root, so on a container without it the whole
 * install fails rather than just the system-library step.
 */
async function installChromeForTesting(): Promise<void> {
  const cli = join(PLUGIN_DIR, "node_modules", "playwright", "cli.js");
  if (!existsSync(cli)) {
    throw new BrowserError(
      "Playwright is not installed in this plugin, so its browser cannot be fetched.",
      {
        status: 503,
        hint: "Reinstall the plugin so its dependencies are installed.",
      },
    );
  }

  const runner = findRunner();
  if (runner === null) {
    throw new BrowserError("No `bun` or `node` on PATH to run Playwright's installer.", {
      status: 503,
      hint: `Install Chromium manually: \`node ${cli} install chromium\`.`,
    });
  }

  const proc = Bun.spawn([runner, cli, "install", "chromium"], {
    // The plugin directory, so the CLI resolves its own package and writes into
    // the registry `executablePath()` reads from.
    cwd: PLUGIN_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const exitCode = await Promise.race([
    proc.exited.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        proc.kill();
        reject(
          new BrowserError(
            `Installing Chromium timed out after ${BROWSER_INSTALL_TIMEOUT_MS / 1000}s.`,
            { status: 504 },
          ),
        );
      }, BROWSER_INSTALL_TIMEOUT_MS);
    }),
  ]);

  if (exitCode !== 0) {
    const stderr = (await new Response(proc.stderr).text()).trim();
    throw new BrowserError(
      `Could not install Chromium: ${stderr === "" ? `exited with code ${exitCode}` : stderr}`,
      {
        status: 503,
        hint: `Install it manually: \`${runner} ${cli} install chromium\`.`,
      },
    );
  }

  // An installer that exits 0 without producing the pinned revision is the
  // exact failure this function exists to prevent, so it is checked rather
  // than assumed.
  if (findChromeForTesting() === null) {
    throw new BrowserError(
      "Playwright's installer finished but its Chromium is still missing.",
      {
        status: 503,
        hint: `Run \`${runner} ${cli} install chromium\` and check its output.`,
      },
    );
  }
}

// ── The singleton ────────────────────────────────────────────────────

let context: BrowserContext | null = null;
let launching: Promise<BrowserContext> | null = null;
let installing: Promise<void> | null = null;

/**
 * Why the last install or launch failed, kept so the app can show it.
 *
 * Without this a failed start is only a log line: the app sees "not running"
 * and cannot say why, which is exactly the dead end where the address bar
 * appears to do nothing. It is cleared on a successful launch.
 */
let lastError: BrowserError | null = null;

/**
 * Launch the persistent context.
 *
 * A persistent context rather than a plain browser: it keeps cookies, storage,
 * and logins in `data/profile`, so a page you signed into is still signed in
 * after a restart. Which is the behavior anyone expects from something calling
 * itself a browser.
 */
async function launch(): Promise<BrowserContext> {
  mkdirSync(PROFILE_DIR, { recursive: true });
  const headless = !canDisplayGui();
  const options = { headless, viewport: { ...DEFAULT_VIEWPORT } };

  const resolved = resolveBrowser();

  if (resolved.source !== "none") {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, {
        ...options,
        ...(resolved.executablePath === null
          ? {}
          : { executablePath: resolved.executablePath }),
      });
    } catch (err) {
      // The browser is on disk but will not start — a partial install, a build
      // the driver cannot drive, missing system libraries. Chrome for Testing
      // is the known-good build, so fall through and fetch it; but if that is
      // what just failed, there is nothing left to try.
      if (resolved.source === "chrome-for-testing") {
        throw new BrowserError(
          `Chromium is installed but would not start: ${err instanceof Error ? err.message : String(err)}`,
          { status: 503 },
        );
      }
    }
  }

  await ensureInstalled();
  return chromium.launchPersistentContext(PROFILE_DIR, options);
}

/**
 * Make sure a Chromium this plugin can drive is on disk.
 *
 * Download only: no window. `init` calls this at boot so a fresh install pays
 * the multi-minute Chrome for Testing fetch in the background, and the app can
 * open a window on load without starting that download from a button click.
 *
 * Single-flight and a no-op when something is already resolvable. A failed
 * install is not cached, so the next call retries.
 */
export async function ensureInstalled(): Promise<void> {
  if (resolveBrowser().source !== "none") {
    return;
  }
  if (installing !== null) {
    return installing;
  }

  installing = installChromeForTesting()
    .catch((err: unknown) => {
      lastError =
        err instanceof BrowserError
          ? err
          : new BrowserError(err instanceof Error ? err.message : String(err), {
              status: 503,
            });
      throw lastError;
    })
    .finally(() => {
      installing = null;
    });

  return installing;
}

/**
 * The context, launching it if it is not up yet.
 *
 * Single-flight: concurrent callers share one launch. A launch that fails is
 * not cached, so the next request retries rather than inheriting the failure
 * for the life of the process.
 */
export async function ensureContext(): Promise<BrowserContext> {
  if (context !== null) {
    return context;
  }
  if (launching !== null) {
    return launching;
  }

  launching = launch()
    .then((launched) => {
      context = launched;
      lastError = null;
      // A context that dies on its own (the user closed the window, the process
      // crashed) must not be handed out again — clear it so the next call
      // relaunches instead of driving a dead handle.
      launched.on("close", () => {
        context = null;
      });
      return launched;
    })
    .catch((err: unknown) => {
      lastError =
        err instanceof BrowserError
          ? err
          : new BrowserError(err instanceof Error ? err.message : String(err), {
              status: 503,
            });
      throw lastError;
    })
    .finally(() => {
      launching = null;
    });

  return launching;
}

/** Why the last launch failed, or null if none has. */
export function getLastError(): { message: string; hint: string | null } | null {
  return lastError === null
    ? null
    : { message: lastError.message, hint: lastError.hint ?? null };
}

/** True while an install or launch is in progress, so the app can say so rather than guess. */
export function isStarting(): boolean {
  return launching !== null || installing !== null;
}

/** True when the browser is up. Read by the status route; never launches. */
export function isRunning(): boolean {
  return context !== null;
}

/** Where the browser executable came from, for the status route. */
export function describeBrowser(): { source: BrowserSource } {
  return { source: resolveBrowser().source };
}

/**
 * Close the browser and release the profile lock.
 *
 * Idempotent and never throws: `shutdown` runs on daemon exit and on in-place
 * redeploys, and a teardown that throws there strands the profile's lock file
 * and blocks the next launch.
 */
export async function closeBrowser(): Promise<void> {
  const open = context;
  context = null;
  await stopScreencast();
  if (open === null) {
    return;
  }
  try {
    await open.close();
  } catch {
    // Already gone, or the process died underneath us. Nothing left to do.
  }
}

/** The underlying browser, when the context exposes one. Used only for logging. */
export function browserVersion(): string | null {
  const browser: Browser | null = context?.browser() ?? null;
  return browser?.version() ?? null;
}
