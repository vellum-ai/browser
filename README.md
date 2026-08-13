# browser

Support an App in your assistant that acts as a browser.

A Vellum plugin that puts a browser in the workspace panel. Address bar,
back/forward/reload, the live page — clickable — its interactive elements, and
its text. It drives Playwright in-process, with its own Chromium and its own
profile, so signing in somewhere stays signed in the next time you open it.

## What it ships

One surface does the work and two support it:

| Surface         | Path             | What it is                                                                                |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| App             | `apps/browser/`  | The browser UI, rendered in the workspace panel. This is the plugin.                      |
| HTTP routes     | `routes/`        | The app's backend, served under `/x/plugins/browser/`. One call per interaction.          |
| Lifecycle hooks | `hooks/`         | `init` installs Chromium at boot; `shutdown` closes a running window.                     |

Everything under `src/` is internal: the browser lifecycle, the in-page element
collector, address-bar resolution, and shared HTTP helpers.

## Install

Not in the marketplace catalog yet, so install straight from this repo:

```
assistant plugins install https://github.com/vellum-ai/browser
```

The CLI prints a warning naming the source, because an unreviewed plugin's code
runs inside the assistant. Then open it from the workspace panel — the app is
addressed as `plugins~browser~browser`.

## How it works

Playwright is a direct dependency, and the page is a live object held in the
daemon process:

```
app (sandboxed frame)
  └─ window.vellum.fetch("/x/plugins/browser/…")
       └─ route  ──▶  Playwright  ──▶  Chromium (own profile, in data/)
```

Holding the page rather than addressing it a command at a time is what buys the
two things that make this feel like a browser:

**History is the page's own.** Back and forward are `page.goBack()` and
`page.goForward()`, so they move through the real session history — including
entries a single-page app pushed itself, which no remembered list of URLs could
reproduce.

**The capture is clickable.** Every element the collector finds comes back with
its geometry, so the app lays a transparent hit target over each one. Clicking
there dispatches by element id, not by guessing at a coordinate. Clicking
anywhere else is a real click at that point, for the things no collector can
enumerate — a canvas, a map, a custom-drawn control.

### Element ids

The collector runs in the page, stamps each element it finds with a
`data-vellum-eid` attribute, and returns the id alongside the description. The
attribute is what makes the id durable: an index into a list goes stale the
moment the DOM shifts, but an attribute on the node survives re-layout, and a
click on it either hits the element it named or fails loudly because the node is
gone. That is the only way this plugin reaches an element, so there is no path
where an id quietly resolves to a different node than the one you were looking
at.

Ids are valid for the collection that produced them, which is why every response
carries a fresh one.

### Getting a Chromium

A plugin's dependencies install with `--ignore-scripts`, so Playwright's own
postinstall never runs and a fresh install has no browser binary. Resolution
walks four options, best first:

1. A Google Chrome already on the machine.
2. Playwright's own Chrome for Testing, if the pinned revision is present.
3. A standalone Chromium the image ships (`/opt/pw-browsers/chromium`,
   `/usr/bin/chromium`, …). Playwright resolves its browser by exact revision,
   so a perfectly good Chromium at a plain path is invisible to it — and
   driving one beats downloading a second copy of the same browser.
4. Otherwise Chrome for Testing, downloaded on demand — a few minutes, once.

That download runs **this plugin's** Playwright CLI by absolute path, not
`bunx playwright`. `bunx` resolves against the working directory, which belongs
to the daemon and not to the plugin, so it misses the copy in `node_modules/`
and fetches whatever the registry serves — downloading a browser at *that*
version's revision while `executablePath()` still points at the one this package
pins. The install appears to succeed and the browser is still missing.

`init` kicks the download off at boot so the wait is paid in the background
rather than by whoever opens the app. It does not open a window and it does not
block: the hook returns immediately, and a start that arrives mid-install joins
the install already running.

The app opens the window when it loads (`POST /start`). The Start button stays
as a retry if that launch fails, or if the user later closes the browser. When
a launch fails, the reason is kept and surfaced with the remediation the route
reported, so a machine that gains a Chromium (or a download that fails once)
does not need an assistant restart to recover.

## The app

- **Address bar** — a URL, a bare host (`example.com:8080/health` works), or a
  search phrase, which goes to DuckDuckGo. Only `http` and `https` are opened;
  `javascript:`, `data:`, and `file:` are refused.
- **Browser state**: the window opens when the app loads. Before a page is
  open, a line says whether the browser is ready, starting, or down. Down shows
  the reason and a Start / Retry button.
- **The page** — click an element, or click anywhere. Hovering an element
  highlights it in the list beside it, and vice versa.
- **Back / forward / reload** — the page's real history.
- **Elements tab** — every interactive element with its role, name, and
  attributes, filterable. Expand a row for Click / Hover / Enter; text fields get
  Type and Type + Enter, and comboboxes select by option label.
- **Text tab** — the page as readable text, optionally with its links.
- **Full page** — capture the whole scrollable page instead of the viewport.
  Element boxes follow; clicking the background is off, since a viewport
  coordinate would mean the wrong thing on a taller image.
- **Live** — re-read the page every few seconds. Skipped while an operation is in
  flight, so a slow page never queues a backlog behind itself.
- **Ask the assistant** — hand the open page to the assistant as a prompt.
  Hidden when the host does not support relaying.
- **Close browser** — shuts Chromium down to free the memory. The profile stays,
  so the next page opens still signed in.

## Configuration

None. The plugin ships no `config.json` and reads no settings: it launches a
browser, keeps its profile in `data/`, and searches with DuckDuckGo. Anything
worth varying can become a setting when there is a reason for it.

## Routes

Served under `/x/plugins/browser/`. The app reaches them through
`window.vellum.fetch`; a bare `fetch` from the sandboxed frame carries no gateway
URL and no auth and fails.

| Route       | Method | Purpose                                                                          |
| ----------- | ------ | -------------------------------------------------------------------------------- |
| `/status`   | GET    | Whether the browser is up, which Chromium backs it, and why a launch failed. Never launches. |
| `/start`    | POST   | Open the window, or retry after a failed launch. Called on app load. Answers like `/status`. |
| `/navigate` | POST   | `{ input }` — raw address-bar value. Returns the page that loaded.               |
| `/view`     | GET    | Re-read the current page. `?fullPage=1` for the whole scrollable page.           |
| `/act`      | POST   | `{ action, … }` — click, click-at, hover, type, press-key, scroll, select-option, back, forward, reload. |
| `/extract`  | GET    | Page text. `?includeLinks=1` appends its links.                                  |
| `/close`    | POST   | Shut the browser down. The profile is kept.                                      |

Every failure answers with `{ error, hint? }`, and the hint is the actionable
half — a stale element id comes back with "reload the page", a missing Chromium
with the command that installs it.

`act` validates its action against an allowlist rather than passing it through,
so a request cannot reach behavior the app does not offer.

## The app runs in a sandboxed frame

The host renders the app in `<iframe sandbox="allow-scripts allow-popups
allow-popups-to-escape-sandbox">`. No `allow-forms`, no `allow-same-origin`,
and no top-level navigation — which rules out three things a UI reaches for by
reflex:

- **No `<form>` and no `type="submit"`.** Submission is blocked, and the
  `submit` event never fires. There is no exception to catch: the button and the
  Enter key simply do nothing. Submitting is a click handler plus an explicit
  Enter key handler.
- **No `<a href>`.** Navigation is blocked, so the link is a dead control.
- **No bare `fetch`.** The frame's origin is opaque and carries no gateway URL
  or auth; `window.vellum.fetch` is the only way to reach the routes.

The first two fail *silently*, which is what makes them worth a rule rather
than a code review. `src/__tests__/app-sandbox.test.ts` fails the build if any
of them come back.

## Page content is untrusted

Element names, attribute values, and body text are authored by whoever controls
the page. The plugin renders them as text and uses them to build arguments;
nothing in the routes or the app treats them as instructions. Element ids are
validated against `e<digits>` before they reach a selector, so a name carrying
selector syntax cannot widen what a click matches.

## Development

```
bun install        # Playwright, plus the devDependencies for typecheck and tests
bun test           # address-bar unit tests, plus collector tests against a real Chromium
bun run typecheck  # tsc over src/, routes/, hooks/, and the app
```

The collector tests drive an actual browser, which is the only way to exercise
code that runs inside the page. They skip when no Chromium is available rather
than failing and looking like a broken collector.

An installed plugin has no `devDependencies` — the installer runs with
`--omit=dev` — and resolves `@vellumai/plugin-api` from the workspace shim. The
app's bundle is compiled by the assistant with its own esbuild and preact.

To iterate without reinstalling, copy the directory into your workspace:

```
cp -R . "$VELLUM_WORKSPACE_DIR/plugins/browser"
```

The plugin source watcher picks up changes: routes are re-read on the next
request, and the app is rebuilt from `apps/browser/src` into `apps/browser/dist`
and served on the next open. `dist/` is generated — never commit it.

## Not in this version

- **Tabs.** One page, reused. Pages a site opens itself (`target="_blank"`, a
  popup) are left alone rather than surfaced.
- **A model-visible tool.** The assistant cannot yet open this app or hand it a
  URL from a conversation.
- **A marketplace listing.** Install from the repo URL until an entry lands in
  `plugins/marketplace.json` upstream.

## License

MIT. See [LICENSE](LICENSE).
