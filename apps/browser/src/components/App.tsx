import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  ApiError,
  act,
  canRelayPrompt,
  closeBrowser,
  fetchStatus,
  fetchText,
  fetchView,
  navigate,
  relayPrompt,
  startBrowser,
} from "../api";
import type { Action, ExtractBody, PageView, StatusBody } from "../api";
import { AddressBar } from "./AddressBar";
import { ElementList } from "./ElementList";
import { ErrorBanner } from "./ErrorBanner";
import { StartupBanner } from "./StartupBanner";
import { TextPanel } from "./TextPanel";
import { Viewport } from "./Viewport";

/** How often the live toggle re-reads the page. */
const LIVE_INTERVAL_MS = 3000;

type Tab = "elements" | "text";

/** Normalize anything thrown by the client into the type the banner renders. */
function asApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError(err instanceof Error ? err.message : String(err), 0, null);
}

export function App() {
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [view, setView] = useState<PageView | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("elements");
  const [text, setText] = useState<ExtractBody | null>(null);
  const [textBusy, setTextBusy] = useState(false);
  const [includeLinks, setIncludeLinks] = useState(false);
  const [fullPage, setFullPage] = useState(false);
  const [live, setLive] = useState(false);
  const [activeEid, setActiveEid] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // The live-refresh interval and the async operations both need to know
  // whether something is already in flight, and neither can read it out of the
  // `busy` state without capturing a stale value.
  const inFlight = useRef(false);

  /**
   * Run one operation against the page.
   *
   * Every caller funnels through here so the busy flag, the error banner, and
   * the single-flight guard are enforced in one place: the panel drives a
   * single browser tab, and two operations racing on it would interleave a
   * click with a reload and then report whichever finished last.
   */
  const run = useCallback(
    async (operation: () => Promise<PageView>): Promise<void> => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const next = await operation();
        setView(next);
        if (next.url !== "") {
          setAddress(next.url);
        }
      } catch (err) {
        setError(asApiError(err));
        // A failed operation may mean the browser died underneath us, which is
        // a retry state rather than a one-off error. Re-read status so the
        // banner can offer the button instead of leaving a dead end.
        void fetchStatus()
          .then(setStatus)
          .catch(() => {
            // Status is a nicety here; the operation's own error already shows.
          });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const go = useCallback(
    (input: string) => {
      void run(() => navigate(input, fullPage));
    },
    [fullPage, run],
  );

  // Back, forward, and reload are the page's own history, not a stack this app
  // keeps. Driving Playwright in-process means `goBack` moves through the real
  // session history — including entries a site pushed itself — which a
  // re-navigation to a remembered URL never could.
  const perform = useCallback(
    (action: Action) => {
      void run(() => act(action, fullPage));
    },
    [fullPage, run],
  );

  /**
   * Open the Chromium window, or try again after a failed launch.
   *
   * Used on app load and by the Start / Retry button. `init` only installs
   * Chromium; this is what creates the window.
   */
  const begin = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      setStatus(await startBrowser());
    } catch (err) {
      setError(asApiError(err));
      // The request can time out while Chromium is still installing. Re-read
      // status so a launch that finished behind the timeout still shows up.
      void fetchStatus()
        .then(setStatus)
        .catch(() => {
          // Status is a nicety here; the start error already shows.
        });
    } finally {
      setStarting(false);
    }
  }, []);

  // Bootstrap: read status, then open the window if it is not already up.
  // The Start button stays as a retry if this fails or the user later closes
  // the browser.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bootstrap = await fetchStatus();
        if (cancelled) {
          return;
        }
        setStatus(bootstrap);
        if (!bootstrap.running) {
          await begin();
        }
      } catch (err) {
        if (!cancelled) {
          setError(asApiError(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [begin]);

  // Live refresh. Skipped whenever an operation is in flight, so a slow page
  // never queues a backlog of captures behind itself.
  useEffect(() => {
    if (!live || view === null) {
      return;
    }
    const timer = setInterval(() => {
      if (!inFlight.current) {
        void run(() => fetchView(fullPage));
      }
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fullPage, live, run, view]);

  /**
   * Identity of the text extraction the Text tab currently wants: the page it
   * belongs to plus whether links are included. Tracking it lets a failed
   * extraction stay failed — without it, an empty `text` and a settled
   * `textBusy` look exactly like "never fetched" and the effect below would
   * retry forever.
   */
  const textToken = useMemo(
    () => `${view?.url ?? ""}|${includeLinks ? "links" : "plain"}`,
    [includeLinks, view],
  );
  const textFetchedFor = useRef<string | null>(null);

  const loadText = useCallback(async (withLinks: boolean) => {
    setTextBusy(true);
    try {
      setText(await fetchText(withLinks));
      setError(null);
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setTextBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "text" || view === null || textFetchedFor.current === textToken) {
      return;
    }
    textFetchedFor.current = textToken;
    setText(null);
    void loadText(includeLinks);
  }, [includeLinks, loadText, tab, textToken, view]);

  const refetchText = useCallback(() => {
    textFetchedFor.current = null;
    setText(null);
  }, []);

  const end = useCallback(async () => {
    setBusy(true);
    try {
      await closeBrowser();
      setView(null);
      setText(null);
      textFetchedFor.current = null;
      setLive(false);
      setError(null);
      setStatus((previous) => (previous === null ? null : { ...previous, running: false }));
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const ask = useCallback(() => {
    if (view === null) {
      return;
    }
    const label = view.title === "" ? view.url : view.title;
    relayPrompt(
      `I have ${view.url} open in the browser app (“${label}”). Take a look at that page and tell me what stands out.`,
    );
  }, [view]);

  return (
    <div class="shell">
      <AddressBar
        value={address}
        busy={busy}
        canNavigate={view !== null}
        onChange={setAddress}
        onSubmit={go}
        onBack={() => perform({ action: "back" })}
        onForward={() => perform({ action: "forward" })}
        onReload={() => perform({ action: "reload" })}
      />

      {status !== null && view === null && (
        <StartupBanner status={status} retrying={starting} onRetry={() => void begin()} />
      )}
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {view === null ? (
        <div class="empty">
          <h1>Welcome to my browser</h1>
          <p>Type a URL or a search above to open a page.</p>
        </div>
      ) : (
        <>
          <div class="page">
            <Viewport
              view={view}
              busy={busy}
              activeEid={activeEid}
              onAct={perform}
              onHoverElement={setActiveEid}
            />
            <aside class="rail">
              <div class="tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "elements"}
                  class={tab === "elements" ? "tab active" : "tab"}
                  onClick={() => setTab("elements")}
                >
                  Elements <span class="count">{view.elements.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "text"}
                  class={tab === "text" ? "tab active" : "tab"}
                  onClick={() => setTab("text")}
                >
                  Text
                </button>
              </div>
              {tab === "elements" ? (
                <ElementList
                  elements={view.elements}
                  busy={busy}
                  activeEid={activeEid}
                  onAct={perform}
                  onHoverElement={setActiveEid}
                />
              ) : (
                <TextPanel
                  text={text}
                  busy={textBusy}
                  includeLinks={includeLinks}
                  onIncludeLinks={setIncludeLinks}
                  onReload={refetchText}
                />
              )}
            </aside>
          </div>

          <footer class="statusbar">
            <span class="page-title" title={view.title}>
              {view.title === "" ? "Untitled page" : view.title}
            </span>
            {view.message !== null && <span class="note">{view.message}</span>}
            <span class="spacer" />
            <label class="toggle">
              <input
                type="checkbox"
                checked={fullPage}
                disabled={busy}
                onChange={(event) => {
                  // Re-capture immediately with the new framing — the toggle
                  // changes what a capture means, so waiting for the next one
                  // would leave the checkbox describing the wrong image.
                  const next = event.currentTarget.checked;
                  setFullPage(next);
                  void run(() => fetchView(next));
                }}
              />
              Full page
            </label>
            <label class="toggle">
              <input
                type="checkbox"
                checked={live}
                onChange={(event) => setLive(event.currentTarget.checked)}
              />
              Live
            </label>
            {canRelayPrompt() && (
              <button type="button" class="link-button" onClick={ask}>
                Ask the assistant
              </button>
            )}
            <button
              type="button"
              class="link-button"
              onClick={() => void end()}
              disabled={busy}
              title="Close the browser. Cookies and logins are kept."
            >
              Close browser
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
