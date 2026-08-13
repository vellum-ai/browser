import { useCallback, useEffect, useState } from "preact/hooks";

import {
  ApiError,
  act,
  canRelayPrompt,
  closeBrowser,
  fetchStatus,
  navigate,
  relayPrompt,
  startBrowser,
} from "../api";
import type { HistoryAction, PageIdentity, StatusBody } from "../api";
import { AddressBar } from "./AddressBar";
import { ErrorBanner } from "./ErrorBanner";
import { StartupBanner } from "./StartupBanner";
import { Viewport } from "./Viewport";

/** Normalize anything thrown by the client into the type the banner renders. */
function asApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError(err instanceof Error ? err.message : String(err), 0, null);
}

export function App() {
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [page, setPage] = useState<PageIdentity | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  const applyPage = useCallback((next: PageIdentity) => {
    setPage(next);
    if (next.url !== "") {
      setAddress(next.url);
    }
  }, []);

  const applyIdentity = useCallback((next: { url: string; title: string }) => {
    if (next.url === "") {
      return;
    }
    setAddress(next.url);
    setPage((current) =>
      current === null
        ? { url: next.url, title: next.title, message: null }
        : { ...current, url: next.url, title: next.title },
    );
  }, []);

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
      void fetchStatus()
        .then(setStatus)
        .catch(() => {
          // Status is a nicety here; the start error already shows.
        });
    } finally {
      setStarting(false);
    }
  }, []);

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

  const go = useCallback((input: string) => {
    setBusy(true);
    setError(null);
    void navigate(input)
      .then(applyPage)
      .catch((err: unknown) => setError(asApiError(err)))
      .finally(() => setBusy(false));
  }, [applyPage]);

  const perform = useCallback((action: HistoryAction) => {
    setBusy(true);
    setError(null);
    void act(action)
      .then(applyPage)
      .catch((err: unknown) => setError(asApiError(err)))
      .finally(() => setBusy(false));
  }, [applyPage]);

  const end = useCallback(async () => {
    setBusy(true);
    try {
      await closeBrowser();
      setPage(null);
      setError(null);
      setStatus((previous) => (previous === null ? null : { ...previous, running: false }));
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const ask = useCallback(() => {
    const url = page?.url ?? "";
    if (url === "") {
      return;
    }
    const title = page?.title ?? "";
    const label = title === "" ? url : title;
    relayPrompt(
      `I have ${url} open in the browser app (“${label}”). Take a look at that page and tell me what stands out.`,
    );
  }, [page]);

  const running = status?.running === true;
  const title = page?.title ?? "";

  return (
    <div class="shell">
      <AddressBar
        value={address}
        busy={busy}
        canNavigate={running}
        onChange={setAddress}
        onSubmit={go}
        onBack={() => perform("back")}
        onForward={() => perform("forward")}
        onReload={() => perform("reload")}
      />

      {!running && status !== null && (
        <StartupBanner status={status} retrying={starting} onRetry={() => void begin()} />
      )}
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {running ? (
        <Viewport onIdentity={applyIdentity} />
      ) : (
        <div class="empty">
          <h1>Welcome to my browser</h1>
          <p>Type a URL or a search above to open a page.</p>
        </div>
      )}

      {running && (
        <footer class="statusbar">
          <span class="page-title" title={title}>
            {title === "" ? "Untitled page" : title}
          </span>
          {page?.message !== null && page?.message !== undefined && (
            <span class="note">{page.message}</span>
          )}
          <span class="spacer" />
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
      )}
    </div>
  );
}
