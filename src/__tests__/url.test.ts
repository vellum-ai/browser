/**
 * Tests for address-bar resolution.
 *
 * The address bar is reachable from the app's sandboxed frame, so what it
 * accepts is a boundary: the scheme allowlist and the "is this a host or a
 * search phrase" decision are both asserted here.
 */

import { describe, expect, test } from "bun:test";

import { BrowserCommandError } from "../assistant-cli.js";
import { isPrivateHost, resolveTarget } from "../url.js";

const SEARCH = "https://search.test/?q={query}";

describe("resolveTarget", () => {
  test("keeps a full URL as-is", () => {
    expect(resolveTarget("https://a.test/x?y=1", SEARCH)).toEqual({
      url: "https://a.test/x?y=1",
      searched: false,
    });
  });

  test("promotes a bare host to https", () => {
    expect(resolveTarget("example.com", SEARCH).url).toBe("https://example.com");
    expect(resolveTarget("example.com/path", SEARCH).url).toBe("https://example.com/path");
    expect(resolveTarget("localhost:3000", SEARCH).url).toBe("https://localhost:3000");
  });

  test("reads a `host:port` as an address, not as a scheme", () => {
    // `localhost:3000` opens with something that looks like a scheme. Treating
    // it as one rejected every port-bearing address as unsupported.
    expect(resolveTarget("example.com:8080/health", SEARCH).url).toBe(
      "https://example.com:8080/health",
    );
  });

  test("searches for a phrase", () => {
    const result = resolveTarget("best coffee", SEARCH);
    expect(result.searched).toBe(true);
    expect(result.url).toBe("https://search.test/?q=best%20coffee");
  });

  test("rejects a phrase when searching is disabled", () => {
    expect(() => resolveTarget("best coffee", "")).toThrow(BrowserCommandError);
  });

  test("rejects schemes the app will not open", () => {
    for (const input of [
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "file:///etc/passwd",
      "ftp://a.test/x",
    ]) {
      expect(() => resolveTarget(input, SEARCH)).toThrow(BrowserCommandError);
    }
  });

  test("rejects empty input", () => {
    expect(() => resolveTarget("   ", SEARCH)).toThrow(BrowserCommandError);
  });

  test("rejects a search template that is not http", () => {
    expect(() => resolveTarget("a phrase", "javascript:{query}")).toThrow(
      BrowserCommandError,
    );
  });
});

describe("isPrivateHost", () => {
  test("recognizes loopback and private ranges", () => {
    for (const url of [
      "http://localhost:3000/",
      "http://app.localhost/",
      "http://127.0.0.1:8080/",
      "http://10.1.2.3/",
      "http://192.168.0.5/",
      "http://172.16.9.9/",
      "http://172.31.0.1/",
      "http://169.254.1.1/",
      "http://printer.local/",
    ]) {
      expect(isPrivateHost(url)).toBe(true);
    }
  });

  test("leaves public hosts alone", () => {
    for (const url of [
      "https://example.com/",
      "https://172.32.0.1/",
      "https://11.0.0.1/",
      "https://192.169.0.1/",
    ]) {
      expect(isPrivateHost(url)).toBe(false);
    }
  });

  test("returns false for input that is not a URL", () => {
    expect(isPrivateHost("not a url")).toBe(false);
  });
});
