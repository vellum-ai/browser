import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  ApiError,
  act,
  canRelayPrompt,
  closeSession,
  fetchStatus,
  fetchText,
  fetchView,
  navigate,
  relayPrompt,
} from "../api";
import type { Action, ExtractBody, PageView, StatusBody } from "../api";
import { AddressBar } from "./AddressBar";
import { BackendBanner } from "./BackendBanner";
import { ElementList } from "./ElementList";
import { ErrorBanner } from "./ErrorBanner";
import { TextPanel } from "./TextPanel";
import { Viewport } from "./Viewport";

/** How often the live toggle re-reads the page. */
const LIVE_INTERVAL_MS = 3000;

type Tab = "elements" | "text";

/**
 * Where a navigation lands in the app's own history.
 *
 * The browser backend exposes no history operations, so back and forward are
 * the app's: it keeps the stack of pages it loaded and re-navigates to move
 * through it. That is why a navigation has to say whether it is making history
 * ("push") or replaying it ("none").
 */
type HistoryMode = "push" | "none";

interface History {
  entries: string[];
  index: number;
}

const EMPTY_HISTORY: History = { entries: [], index: -1 };

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
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);

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
    async (
      operation: () => Promise<PageView>,
      historyMode: HistoryMode = "push",
    ): Promise<void> => {
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
          if (historyMode === "push") {
            setHistory((prev) => {
              const trimmed = prev.entries.slice(0, prev.index + 1);
              if (trimmed[trimmed.length - 1] === next.url) {
                return { entries: trimmed, index: trimmed.length - 1 };
              }
              const entries = [...trimmed, next.url];
              return { entries, index: entries.length - 1 };
            });
          }
        }
      } catch (err) {
        setError(asApiError(err));
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const go = useCallback(
    (input: string, historyMode: HistoryMode = "push") => {
      void run(() => navigate(input), historyMode);
    },
    [run],
  );

  const reload = useCallback(() => {
    void run(() => fetchView(fullPage), "none");
  }, [fullPage, run]);

  const perform = useCallback(
    (action: Action) => {
      void run(() => act(action));
    },
    [run],
  );

  const back = useCallback(() => {
    const target = history.entries[history.index - 1];
    if (target === undefined) {
      return;
    }
    setHistory({ entries: history.entries, index: history.index - 1 });
    go(target, "none");
  }, [go, history]);

  const forward = useCallback(() => {
    const target = history.entries[history.index + 1];
    if (target === undefined) {
      return;
    }
    setHistory({ entries: history.entries, index: history.index + 1 });
    go(target, "none");
  }, [go, history]);

  // Bootstrap: read settings and backend readiness, then open the home page if
  // one is configured.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const bootstrap = await fetchStatus();
        if (cancelled) {
          return;
        }
        setStatus(bootstrap);
        if (bootstrap.homeUrl !== "") {
          setAddress(bootstrap.homeUrl);
          go(bootstrap.homeUrl);
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
  }, [go]);

  // Live refresh. Skipped whenever an operation is in flight, so a slow page
  // never queues a backlog of captures behind itself.
  useEffect(() => {
    if (!live || view === null) {
      return;
    }
    const timer = setInterval(() => {
      if (!inFlight.current) {
        void run(() => fetchView(fullPage), "none");
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
      const result = await closeSession();
      setView(null);
      setText(null);
      textFetchedFor.current = null;
      setHistory(EMPTY_HISTORY);
      setLive(false);
      setError(
        result.problems.length === 0 ? null : new ApiError(result.problems.join(" "), 0, null),
      );
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
        canGoBack={history.index > 0}
        canGoForward={history.index >= 0 && history.index < history.entries.length - 1}
        canReload={view !== null}
        searchEnabled={status?.searchEnabled ?? false}
        onChange={setAddress}
        onSubmit={(input) => go(input)}
        onBack={back}
        onForward={forward}
        onReload={reload}
      />

      {status !== null && <BackendBanner status={status} collapsed={view !== null} />}
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {view === null ? (
        <div class="empty">
          <h1>A browser, in the panel</h1>
          <p>
            Type a URL above
            {status?.searchEnabled === true ? " — or a search phrase — " : " "}
            to open a page. It loads in the assistant&rsquo;s own browser on the{" "}
            <code>{status?.session ?? "browser-app"}</code> session, so it stays separate from
            whatever the assistant is browsing in a conversation.
          </p>
        </div>
      ) : (
        <>
          <div class="page">
            <Viewport
              view={view}
              busy={busy}
              onScroll={(direction) => perform({ action: "scroll", direction })}
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
                <ElementList elements={view.elements} busy={busy} onAct={perform} />
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
                  void run(() => fetchView(next), "none");
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
            <button type="button" class="link-button" onClick={() => void end()} disabled={busy}>
              Close page
            </button>
          </footer>
        </>
      )}
    </div>
  );
}
