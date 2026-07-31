# browser

Support an App in your assistant that acts as a browser.

A Vellum plugin that puts a browser in the workspace panel. You get an address
bar, back/forward/reload, the live page, the page's interactive elements, and
its text — driving the assistant's own browser backend, so the pages you open
here are the same pages the assistant can see.

## What it ships

One surface does the work and two support it:

| Surface        | Path            | What it is                                                                                    |
| -------------- | --------------- | --------------------------------------------------------------------------------------------- |
| App            | `apps/browser/` | The browser UI, rendered in the workspace panel. This is the plugin.                          |
| HTTP routes    | `routes/`       | The app's backend, served under `/x/plugins/browser/`. Drives the browser, one call per step. |
| Lifecycle hook | `hooks/init.ts` | Validates config at boot and reports whether the browser is reachable.                        |

Everything under `src/` is internal: config loading, the CLI wrapper, the output
parsers, and the shared HTTP helpers.

## Install

Not in the marketplace catalog yet, so install straight from this repo:

```
assistant plugins install https://github.com/vellum-ai/browser
```

The CLI prints a warning naming the source, because an unreviewed plugin's code
runs inside the assistant. Then open it from the workspace panel — the app is
addressed as `plugins~browser~browser`.

To confirm it loaded:

```
assistant plugins list          # status should be `ok`
assistant plugins inspect browser
```

## How it works

The assistant already has a browser: a CDP-driven stack with three backends
(the Chrome extension, an attached Chrome over the DevTools Protocol, and a
Playwright-managed Chromium), reachable through `assistant browser`. This plugin
does not ship a second one. Its routes call that CLI with `--json` and turn the
results into something the app can render:

```
app (sandboxed frame)
  └─ window.vellum.fetch("/x/plugins/browser/…")
       └─ route  ──▶  assistant browser --json <operation>
                        └─ daemon IPC ──▶ the assistant's browser backend
```

Two properties fall out of that design and are worth knowing:

**Your browsing here is separate from the assistant's.** Every call carries
`--session browser-app`, and a session is the isolation unit for pages, cookies,
and element ids. Whatever the assistant is browsing inside a conversation is on
its own session and is not disturbed by this app — and the reverse. No
conversation id is ever passed, so the app's session is never bound to a
particular chat.

**The page is a still, and the element list is the input surface.** The backend
captures screenshots and exposes interaction by element id; nothing maps a click
at (x, y) back to a node. So the capture is deliberately not clickable —
pretending otherwise would produce clicks that land nowhere — and clicking,
typing, hovering, and option-picking all happen in the element rail beside it.
Scroll is the exception, because it needs no target. Element ids are only valid
for the snapshot they came from, so every response carries a fresh one.

## The app

- **Address bar** — a URL, a bare host (`example.com:8080/health` works), or a
  search phrase. Only `http` and `https` are opened; `javascript:`, `data:`, and
  `file:` are refused. Loopback and private-range hosts opt into the backend's
  private-network allowance automatically, so a local dev server just works.
- **Back / forward** — the app's own history. The backend has no history
  operations, so moving through it re-navigates.
- **Elements tab** — every interactive element with its role, name, and
  attributes, filterable. Expand a row for Click / Hover / Enter; text fields get
  Type and Type + Enter, and comboboxes select by option label.
- **Text tab** — the page as readable text, optionally with its links. This is
  what makes a screenshot-based browser usable for actually reading a page.
- **Full page** — capture the whole scrollable page instead of the viewport.
- **Live** — re-read the page every few seconds. Skipped while an operation is in
  flight, so a slow page never queues a backlog behind itself.
- **Ask the assistant** — hand the open page to the assistant as a prompt.
  Hidden when the host does not support relaying.
- **Close page** — closes the page and detaches the debugger, which is what hands
  a tab back to you on the extension backend.

## Configuration

`config.json` at the plugin root. It is a preserved entry: edit it in place and
your changes survive upgrades and re-installs. Every value is re-read on the next
request — no restart.

| Key                 | Default                             | What it does                                                                                             |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `sessionId`         | `browser-app`                       | The browser session the app drives. Change it to isolate further; avoid `default`, which the model uses.  |
| `browserMode`       | `auto`                              | Pin a backend: `auto`, `extension`, `cdp-inspect`, or `local`.                                            |
| `homeUrl`           | `""`                                | Page to open on launch. Empty shows the empty state.                                                      |
| `searchUrlTemplate` | `https://duckduckgo.com/?q={query}` | Where non-URL address-bar input goes. Empty disables searching, so a phrase is rejected instead.           |
| `commandTimeoutMs`  | `60000`                             | Per-operation timeout, clamped to 5s–180s.                                                                |
| `assistantBin`      | `""`                                | Absolute path to the `assistant` CLI. Empty auto-detects.                                                 |

A malformed value falls back to its default rather than failing the request, and
`init` logs a warning naming what it ignored.

### The Chrome extension is the best backend

`browserMode: auto` picks the best available backend, and on a paired setup that
is the Chrome extension: it uses your real profile, so pages you are already
logged into are pages this app can open. If the banner at the top of the app
reports no backend, it renders the remediation steps the assistant's own status
probe returns — most often "install and pair the Vellum Assistant Chrome
extension."

## Routes

Served under `/x/plugins/browser/`. The app reaches them through
`window.vellum.fetch`; a bare `fetch` from the sandboxed frame carries no gateway
URL and no auth and fails.

| Route       | Method | Purpose                                                                 |
| ----------- | ------ | ----------------------------------------------------------------------- |
| `/status`   | GET    | Settings and per-backend readiness. The app's bootstrap call.            |
| `/navigate` | POST   | `{ input }` — raw address-bar value. Returns the page that loaded.       |
| `/view`     | GET    | Re-read the current page. `?fullPage=1` for the whole scrollable page.   |
| `/act`      | POST   | `{ action, … }` — click, hover, type, press-key, scroll, select-option.  |
| `/extract`  | GET    | Page text. `?includeLinks=1` appends its links.                          |
| `/close`    | POST   | Close the page and detach.                                              |

Every failure answers with `{ error, hint? }`, and the hint is the actionable
half — an unresolvable CLI or a disabled search template both come back with the
exact `config.json` edit that fixes them.

`act` validates `action` against an allowlist rather than passing it through, and
`fill_credential` is deliberately not reachable: it reads the credential vault,
and that belongs behind the model's own tools and their approval path, not behind
a button in a panel.

## Page content is untrusted

Titles, element names, attribute values, and body text are all authored by
whoever controls the page, which is why the assistant hands them back inside an
`<external_content>` fence. The plugin unwraps that fence to render the content
as data — as text in the DOM, and as arguments when you act on an element — and
nothing in the routes or the app treats it as instructions.

## Development

```
bun install        # devDependencies only — typecheck and tests
bun test           # parser and address-bar tests
bun run typecheck  # tsc over src/, routes/, hooks/, and the app
```

`devDependencies` exist purely for local typechecking and tests. An installed
plugin has no `node_modules`: it resolves `@vellumai/plugin-api` from the
workspace shim, and the app's bundle is compiled by the assistant with its own
esbuild and preact.

To iterate without reinstalling, copy the directory into your workspace:

```
cp -R . "$VELLUM_WORKSPACE_DIR/plugins/browser"
```

The plugin source watcher picks up changes: routes are re-read on the next
request, and the app is rebuilt from `apps/browser/src` into `apps/browser/dist`
and served on the next open. `dist/` is generated — never commit it.

## Not in this version

- **Clicking the page image.** Needs a coordinate-addressed click in the browser
  backend; today interaction is by element id only.
- **Tabs.** The backend has a `browser tabs` group the app does not surface yet.
- **A model-visible tool.** The assistant cannot yet open this app or hand it a
  URL from a conversation.
- **A marketplace listing.** Install from the repo URL until an entry lands in
  `plugins/marketplace.json` upstream.

## License

MIT. See [LICENSE](LICENSE).
