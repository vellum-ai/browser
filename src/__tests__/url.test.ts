/**
 * Tests for address-bar resolution.
 *
 * The address bar is reachable from the app's sandboxed frame, so what it
 * accepts is a boundary: the scheme allowlist and the "is this a host or a
 * search phrase" decision are both asserted here.
 */

import { describe, expect, test } from "bun:test";

import { BrowserError } from "../browser.js";
import { resolveTarget } from "../url.js";

describe("resolveTarget", () => {
  test("keeps a full URL as-is", () => {
    expect(resolveTarget("https://a.test/x?y=1")).toEqual({
      url: "https://a.test/x?y=1",
      searched: false,
    });
  });

  test("promotes a bare host to https", () => {
    expect(resolveTarget("example.com").url).toBe("https://example.com");
    expect(resolveTarget("example.com/path").url).toBe("https://example.com/path");
    expect(resolveTarget("localhost:3000").url).toBe("https://localhost:3000");
  });

  test("reads a `host:port` as an address, not as a scheme", () => {
    // `localhost:3000` opens with something that looks like a scheme. Treating
    // it as one rejected every port-bearing address as unsupported.
    expect(resolveTarget("example.com:8080/health").url).toBe(
      "https://example.com:8080/health",
    );
  });

  test("searches for a phrase", () => {
    const result = resolveTarget("best coffee");
    expect(result.searched).toBe(true);
    expect(result.url).toBe("https://duckduckgo.com/?q=best%20coffee");
  });

  test("percent-encodes a phrase rather than splicing it in raw", () => {
    expect(resolveTarget("a&b=c #x").url).toBe(
      "https://duckduckgo.com/?q=a%26b%3Dc%20%23x",
    );
  });

  test("rejects schemes the app will not open", () => {
    for (const input of [
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "file:///etc/passwd",
      "ftp://a.test/x",
    ]) {
      expect(() => resolveTarget(input)).toThrow(BrowserError);
    }
  });

  test("rejects empty input", () => {
    expect(() => resolveTarget("   ")).toThrow(BrowserError);
  });
});
