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
 * they share the instance. `init` launches it at boot and `shutdown` closes it.
 * {@link ensurePage} is still lazy and single-flight, so a request that lands
 * before the boot launch settles waits for that same launch instead of starting
 * a second one.
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

import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

/** How long the on-demand Chrome for Testing download is allowed to take. */
const BROWSER_INSTALL_TIMEOUT_MS = 300_000;

/** Viewport the page runs at, and therefore the size of every capture. */
export const VIEWPORT = { width: 1280, height: 800 } as const;

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

/** True when Playwright's own Chromium build is present on disk. */
function hasChromeForTesting(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    // executablePath() throws when the browser registry is missing entirely.
    return false;
  }
}

/**
 * Download Chrome for Testing. Only reached when no system Chrome was found,
 * because a plugin install runs with `--ignore-scripts` and never fetches it.
 */
async function installChromeForTesting(): Promise<void> {
  if (hasChromeForTesting()) {
    return;
  }

  const proc = Bun.spawn(["bunx", "playwright", "install", "--with-deps", "chromium"], {
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
        hint: "Run `bunx playwright install chromium` and reload the plugin.",
      },
    );
  }
}

// ── The singleton ────────────────────────────────────────────────────

let context: BrowserContext | null = null;
let launching: Promise<BrowserContext> | null = null;

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
  const options = { headless, viewport: { ...VIEWPORT } };

  const systemChrome = findSystemChrome();
  if (systemChrome !== null) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, {
        ...options,
        executablePath: systemChrome,
      });
    } catch {
      // Chrome is installed but will not start (a partial install, a version
      // the driver cannot drive). Chrome for Testing is the known-good build,
      // so fall through to it rather than failing outright.
    }
  }

  await installChromeForTesting();
  return chromium.launchPersistentContext(PROFILE_DIR, options);
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
      // A context that dies on its own (the user closed the window, the process
      // crashed) must not be handed out again — clear it so the next call
      // relaunches instead of driving a dead handle.
      launched.on("close", () => {
        context = null;
      });
      return launched;
    })
    .finally(() => {
      launching = null;
    });

  return launching;
}

/**
 * The page the app drives.
 *
 * One page, reused: the app is a single browser tab, and a persistent context
 * opens with one already. Pages the site opens itself (`target="_blank"`, a
 * popup) are left alone — surfacing them is what a tab strip would be for.
 */
export async function ensurePage(): Promise<Page> {
  const ctx = await ensureContext();
  const existing = ctx.pages()[0];
  if (existing !== undefined && !existing.isClosed()) {
    return existing;
  }
  return ctx.newPage();
}

/** True when the browser is up. Read by the status route; never launches. */
export function isRunning(): boolean {
  return context !== null;
}

/** Where the browser executable came from, for the status route. */
export function describeBrowser(): { source: "system-chrome" | "chrome-for-testing" | "none" } {
  if (findSystemChrome() !== null) {
    return { source: "system-chrome" };
  }
  return { source: hasChromeForTesting() ? "chrome-for-testing" : "none" };
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
