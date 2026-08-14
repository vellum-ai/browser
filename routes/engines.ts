/**
 * `GET|POST /x/plugins/browser/engines`: installed engines and the default.
 *
 * Chromium Debugging is always present (the plugin installs Chromium at
 * boot). Lightpanda is optional: install downloads a nightly binary, uninstall
 * deletes it, and set-default switches which engine `POST /start` launches.
 */

import { closeBrowser, isRunning } from "../src/browser.js";
import {
  defaultEngine,
  engineHasLiveView,
  isEngineId,
  readEngine,
  writeEngine,
} from "../src/engine-config.js";
import type { EngineId } from "../src/engine-config.js";
import { BrowserError } from "../src/errors.js";
import { handle, ok, readJson, requireString } from "../src/http.js";
import {
  installLightpanda,
  isLightpandaInstalled,
  isLightpandaInstalling,
  lightpandaAsset,
  uninstallLightpanda,
} from "../src/lightpanda.js";
import { exclusive } from "../src/lock.js";
import { ensureSession } from "../src/session.js";
import { buildStatus } from "../src/status.js";
import type { StatusBody } from "../src/status.js";

export interface EngineInfo {
  id: EngineId;
  label: string;
  installed: boolean;
  installing: boolean;
  available: boolean;
  isDefault: boolean;
  liveView: boolean;
  note: string | null;
}

export interface EnginesBody {
  engines: EngineInfo[];
  defaultEngine: EngineId;
  status: StatusBody;
}

function snapshot(): EnginesBody {
  const current = readEngine();
  const chromium: EngineInfo = {
    id: "chromium",
    label: "Chromium Debugging",
    installed: true,
    installing: false,
    available: true,
    isDefault: current === "chromium",
    liveView: engineHasLiveView("chromium"),
    note: null,
  };
  const pandaAvailable = lightpandaAsset() !== null;
  const lightpanda: EngineInfo = {
    id: "lightpanda",
    label: "Lightpanda",
    installed: isLightpandaInstalled(),
    installing: isLightpandaInstalling(),
    available: pandaAvailable,
    isDefault: current === "lightpanda",
    liveView: engineHasLiveView("lightpanda"),
    note: pandaAvailable
      ? "Headless agent engine. There is no live page view."
      : "No Lightpanda binary ships for this machine.",
  };
  return {
    engines: [chromium, lightpanda],
    defaultEngine: current,
    status: buildStatus(),
  };
}

export async function GET(): Promise<Response> {
  return handle(async () => ok(snapshot()));
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(request);
    const action = requireString(body, "action");
    const engineRaw = requireString(body, "engine");
    if (!isEngineId(engineRaw)) {
      throw new BrowserError("`engine` must be chromium or lightpanda.", { status: 400 });
    }
    const engine = engineRaw;

    if (action === "install") {
      if (engine !== "lightpanda") {
        throw new BrowserError("Chromium Debugging is installed with the plugin.", { status: 400 });
      }
      await installLightpanda();
      return ok(snapshot());
    }

    if (action === "uninstall") {
      if (engine !== "lightpanda") {
        throw new BrowserError("Chromium Debugging cannot be uninstalled.", { status: 400 });
      }
      return exclusive(async () => {
        if (readEngine() === "lightpanda") {
          if (isRunning()) {
            await closeBrowser();
          }
          writeEngine(defaultEngine());
        }
        await uninstallLightpanda();
        return ok(snapshot());
      });
    }

    if (action === "set-default") {
      if (engine === "lightpanda" && !isLightpandaInstalled()) {
        throw new BrowserError("Install Lightpanda before setting it as the default.", {
          status: 409,
        });
      }
      return exclusive(async () => {
        const running = isRunning();
        if (running) {
          await closeBrowser();
        }
        writeEngine(engine);
        if (running) {
          await ensureSession();
        }
        return ok(snapshot());
      });
    }

    throw new BrowserError(
      `Unsupported action \`${action}\`. Expected install, uninstall, or set-default.`,
      { status: 400 },
    );
  });
}
