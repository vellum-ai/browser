#!/usr/bin/env bun
/**
 * Drive this plugin's browser through its HTTP routes.
 *
 * Calls go through the internal gateway so they hit the same Playwright
 * session the app is showing. This is not the host Chrome-extension CLI.
 */

const BASE = `${process.env.INTERNAL_GATEWAY_BASE_URL ?? "http://127.0.0.1:7830"}/v1/x/plugins/browser`;

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method, headers: { accept: "application/json" } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // Keep the raw text when the route did not answer JSON.
  }
  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${response.status}`;
    console.error(message);
    process.exit(1);
  }
  console.log(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));
  return parsed;
}

function usage(): never {
  console.error(`Usage:
  bun scripts/browser.ts status
  bun scripts/browser.ts start
  bun scripts/browser.ts navigate <url-or-search>
  bun scripts/browser.ts snapshot
  bun scripts/browser.ts extract [--links]
  bun scripts/browser.ts click <eid>
  bun scripts/browser.ts type <eid> <text>
  bun scripts/browser.ts act back|forward|reload
  bun scripts/browser.ts session`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
if (command === undefined) {
  usage();
}

switch (command) {
  case "status": {
    await call("GET", "/status");
    break;
  }
  case "start": {
    await call("POST", "/start", {});
    break;
  }
  case "navigate": {
    const input = rest.join(" ").trim();
    if (input === "") {
      usage();
    }
    await call("POST", "/navigate", { input });
    break;
  }
  case "snapshot": {
    await call("GET", "/snapshot");
    break;
  }
  case "extract": {
    const links = rest.includes("--links") ? "?includeLinks=1" : "";
    await call("GET", `/extract${links}`);
    break;
  }
  case "click": {
    const eid = rest[0];
    if (eid === undefined) {
      usage();
    }
    await call("POST", "/element", { action: "click", eid });
    break;
  }
  case "type": {
    const eid = rest[0];
    const text = rest.slice(1).join(" ");
    if (eid === undefined || text === "") {
      usage();
    }
    await call("POST", "/element", { action: "type", eid, text });
    break;
  }
  case "act": {
    const action = rest[0];
    if (action !== "back" && action !== "forward" && action !== "reload") {
      usage();
    }
    await call("POST", "/act", { action });
    break;
  }
  case "session": {
    await call("GET", "/session");
    break;
  }
  default: {
    usage();
  }
}
