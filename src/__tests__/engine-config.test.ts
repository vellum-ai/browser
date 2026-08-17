import { describe, expect, test } from "bun:test";

import {
  defaultEngine,
  engineHasLiveView,
  isEngineId,
} from "../engine-config.js";
import { lightpandaAsset } from "../lightpanda.js";

describe("engine config", () => {
  test("defaults to Chromium Debugging", () => {
    expect(defaultEngine()).toBe("chromium");
    expect(engineHasLiveView("chromium")).toBe(true);
    expect(engineHasLiveView("lightpanda")).toBe(false);
  });

  test("accepts only the two engine ids", () => {
    expect(isEngineId("chromium")).toBe(true);
    expect(isEngineId("lightpanda")).toBe(true);
    expect(isEngineId("patchright")).toBe(false);
    expect(isEngineId("")).toBe(false);
  });
});

describe("lightpanda asset", () => {
  test("names a nightly binary for linux and macOS", () => {
    const asset = lightpandaAsset();
    if (process.platform === "win32") {
      expect(asset).toBeNull();
      return;
    }
    expect(asset).not.toBeNull();
    expect(asset?.url).toContain("/releases/download/nightly/");
    expect(asset?.filename.startsWith("lightpanda-")).toBe(true);
  });
});
