---
name: browser
description: >-
  Browse the web through the workspace Browser plugin (Playwright Chromium or
  Lightpanda). Use this whenever the user wants this plugin's browser, the
  Browser app, or to navigate/click/extract in the workspace panel. Do not use
  `assistant browser` or the Chrome extension for those requests.
metadata:
  emoji: "🌐"
  vellum:
    display-name: "Workspace Browser"
    category: "browsing"
    activation-hints:
      - "User asks to open a URL, click, type, or extract in the workspace browser plugin"
      - "User has the Browser app open (plugins~browser~browser)"
      - "User says browse, web page, or interact with the plugin browser"
    avoid-when:
      - "User explicitly asks for the Chrome extension or the assistant browser CLI"
---

Drive **this plugin's** browser. It is the Playwright session behind the Browser app (`plugins~browser~browser`).

**Never** use `assistant browser`, `--browser-mode extension`, `cdp-inspect`, or the Chrome extension flow for these requests. Those drive a different browser.

## How to call it

From this skill directory, run `bun scripts/browser.ts <command>`. The script posts to `$INTERNAL_GATEWAY_BASE_URL/v1/x/plugins/browser/…`, which is the same session the app is showing.

| Command | What it does |
| --- | --- |
| `bun scripts/browser.ts status` | Whether the engine is up |
| `bun scripts/browser.ts start` | Open the window if it is not running |
| `bun scripts/browser.ts navigate <url-or-search>` | Load a URL, host, or search phrase |
| `bun scripts/browser.ts snapshot` | Interactive elements with `eid` handles |
| `bun scripts/browser.ts click <eid>` | Click a snapshotted element |
| `bun scripts/browser.ts type <eid> <text>` | Fill a snapshotted input |
| `bun scripts/browser.ts extract [--links]` | Visible page text |
| `bun scripts/browser.ts act back` (or `forward`, `reload`) | History |
| `bun scripts/browser.ts session` | Windows and tabs |

## Workflow

1. `status`. If `running` is false, `start`.
2. Ask the user to open the Browser app from the workspace panel if they should see the page. The app id is `plugins~browser~browser`.
3. `navigate` to the target.
4. `snapshot` before any click or type. Ids are only valid until the next snapshot.
5. `click` / `type` by `eid`. After the DOM changes, snapshot again.
6. `extract` when you need the page as text.

Do not screenshot via `assistant browser`. The live picture is already in the app for Chromium Debugging. Lightpanda has no live view; extract and snapshot still work.

## Engines

The user picks the engine in Browser settings (gear icon). Chromium Debugging is the default and paints the page. Lightpanda is optional, headless, and has no live picture.
