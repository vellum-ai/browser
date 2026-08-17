/**
 * Optional Lightpanda engine: download, spawn, and tear down.
 *
 * Lightpanda is a headless Zig browser that speaks CDP. It is not Chromium and
 * has no compositor, so this plugin cannot paint a live page from it. The
 * assistant can still navigate and extract. The binary is AGPL-3.0 and is
 * downloaded on demand into `data/`; it is not a package dependency.
 */

import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";

import { BrowserError } from "./errors.js";
import { LIGHTPANDA_BIN, LIGHTPANDA_DIR } from "./paths.js";

const INSTALL_TIMEOUT_MS = 180_000;
const READY_TIMEOUT_MS = 15_000;

export interface LightpandaAsset {
  filename: string;
  url: string;
}

let installing: Promise<void> | null = null;
let proc: ReturnType<typeof Bun.spawn> | null = null;
let servingPort: number | null = null;

/** The GitHub nightly asset for this machine, or null when none ships. */
export function lightpandaAsset(): LightpandaAsset | null {
  const { platform, arch } = process;
  let filename: string | null = null;
  if (platform === "linux" && arch === "x64") {
    filename = "lightpanda-x86_64-linux";
  } else if (platform === "linux" && arch === "arm64") {
    filename = "lightpanda-aarch64-linux";
  } else if (platform === "darwin" && arch === "arm64") {
    filename = "lightpanda-aarch64-macos";
  } else if (platform === "darwin" && arch === "x64") {
    filename = "lightpanda-x86_64-macos";
  }
  if (filename === null) {
    return null;
  }
  return {
    filename,
    url: `https://github.com/lightpanda-io/browser/releases/download/nightly/${filename}`,
  };
}

export function isLightpandaInstalled(): boolean {
  return existsSync(LIGHTPANDA_BIN);
}

export function isLightpandaInstalling(): boolean {
  return installing !== null;
}

export function isLightpandaRunning(): boolean {
  return proc !== null && servingPort !== null;
}

export function lightpandaEndpoint(): { host: string; port: number } | null {
  if (proc === null || servingPort === null) {
    return null;
  }
  return { host: "127.0.0.1", port: servingPort };
}

function unsupportedError(): BrowserError {
  return new BrowserError(
    "Lightpanda is not available on this machine.",
    {
      status: 400,
      hint: "Lightpanda ships Linux and macOS binaries. Chromium Debugging stays available.",
    },
  );
}

/**
 * Download the Lightpanda binary into the plugin data dir.
 *
 * Single-flight. A failed install is not cached, so the next call retries.
 */
export async function installLightpanda(): Promise<void> {
  if (isLightpandaInstalled()) {
    return;
  }
  if (installing !== null) {
    return installing;
  }
  const asset = lightpandaAsset();
  if (asset === null) {
    throw unsupportedError();
  }

  installing = (async () => {
    mkdirSync(LIGHTPANDA_DIR, { recursive: true });
    const response = await fetch(asset.url, {
      headers: { "user-agent": "vellum-browser-plugin" },
      signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new BrowserError(
        `Could not download Lightpanda (${response.status}).`,
        {
          status: 503,
          hint: `Try again, or download ${asset.url} yourself into the plugin data directory.`,
        },
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1024) {
      throw new BrowserError("The Lightpanda download was empty.", { status: 503 });
    }
    await Bun.write(LIGHTPANDA_BIN, bytes);
    chmodSync(LIGHTPANDA_BIN, 0o755);
  })().finally(() => {
    installing = null;
  });

  return installing;
}

/** Stop a running process and delete the downloaded binary. */
export async function uninstallLightpanda(): Promise<void> {
  await stopLightpanda();
  if (existsSync(LIGHTPANDA_DIR)) {
    rmSync(LIGHTPANDA_DIR, { recursive: true, force: true });
  }
}

async function freePort(): Promise<number> {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {},
      data() {},
      close() {},
      error() {},
    },
  });
  const { port } = server;
  server.stop(true);
  return port;
}

async function waitUntilReady(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/json/version`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(100);
  }
  throw new BrowserError("Lightpanda started but its CDP port never became ready.", {
    status: 504,
  });
}

/** Spawn `lightpanda serve` on a loopback port and wait until CDP answers. */
export async function startLightpanda(): Promise<{ host: string; port: number }> {
  if (proc !== null && servingPort !== null) {
    return { host: "127.0.0.1", port: servingPort };
  }
  if (!isLightpandaInstalled()) {
    throw new BrowserError("Lightpanda is not installed.", {
      status: 409,
      hint: "Install it from Browser settings.",
    });
  }

  const port = await freePort();
  const child = Bun.spawn([LIGHTPANDA_BIN, "serve", "--host", "127.0.0.1", "--port", String(port)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  proc = child;
  servingPort = port;

  try {
    await waitUntilReady(port);
  } catch (err) {
    await stopLightpanda();
    throw err;
  }

  void child.exited.then(() => {
    if (proc === child) {
      proc = null;
      servingPort = null;
    }
  });

  return { host: "127.0.0.1", port };
}

/** Stop the Lightpanda process. Safe when nothing is up. */
export async function stopLightpanda(): Promise<void> {
  const child = proc;
  proc = null;
  servingPort = null;
  if (child === null) {
    return;
  }
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  try {
    await child.exited;
  } catch {
    // Already gone.
  }
}
