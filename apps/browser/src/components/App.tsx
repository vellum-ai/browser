import { useCallback, useEffect, useState } from "preact/hooks";

import {
  ApiError,
  act,
  fetchSession,
  fetchStatus,
  mutateSession,
  navigate,
  startBrowser,
} from "../api";
import type { HistoryAction, SessionInfo, StatusBody } from "../api";
import { AddressBar } from "./AddressBar";
import { TabBar, WindowBar } from "./Chrome";
import { ErrorBanner } from "./ErrorBanner";
import { Settings } from "./Settings";
import { StartupBanner } from "./StartupBanner";
import { Viewport } from "./Viewport";

/** Normalize anything thrown by the client into the type the banner renders. */
function asApiError(err: unknown): ApiError {
  return err instanceof ApiError
    ? err
    : new ApiError(err instanceof Error ? err.message : String(err), 0, null);
}

function emptySession(): SessionInfo {
  return { windows: [], activeWindowId: "", activeTabId: "" };
}

export function App() {
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [session, setSession] = useState<SessionInfo>(emptySession);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [inSettings, setInSettings] = useState(false);

  const applyUrl = useCallback((url: string) => {
    if (url !== "") {
      setAddress(url);
    }
  }, []);

  const applySession = useCallback((next: SessionInfo) => {
    setSession(next);
    const window = next.windows.find((item) => item.id === next.activeWindowId);
    const tab = window?.tabs.find((item) => item.id === next.activeTabId);
    if (tab === undefined) {
      return;
    }
    setAddress(tab.url === "about:blank" ? "" : tab.url);
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

  const running = status?.running === true;

  useEffect(() => {
    if (!running) {
      setSession(emptySession());
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchSession();
        if (!cancelled) {
          applySession(next);
        }
      } catch {
        // The next tick retries.
      }
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, applySession]);

  const go = useCallback((input: string) => {
    setBusy(true);
    setError(null);
    void navigate(input)
      .then((next) => {
        applyUrl(next.url);
        return fetchSession();
      })
      .then(applySession)
      .catch((err: unknown) => setError(asApiError(err)))
      .finally(() => setBusy(false));
  }, [applySession, applyUrl]);

  const perform = useCallback((action: HistoryAction) => {
    setBusy(true);
    setError(null);
    void act(action)
      .then((next) => {
        applyUrl(next.url);
        return fetchSession();
      })
      .then(applySession)
      .catch((err: unknown) => setError(asApiError(err)))
      .finally(() => setBusy(false));
  }, [applySession, applyUrl]);

  const changeSession = useCallback((work: () => Promise<SessionInfo>) => {
    setError(null);
    void work()
      .then(applySession)
      .catch((err: unknown) => setError(asApiError(err)));
  }, [applySession]);

  const activeWindow = session.windows.find((item) => item.id === session.activeWindowId);
  const tabs = activeWindow?.tabs ?? [];
  const canCloseTab = session.windows.reduce((sum, window) => sum + window.tabs.length, 0) > 1;

  return (
    <div class="shell">
      {running && !inSettings && session.windows.length > 0 && (
        <WindowBar
          windows={session.windows}
          onSelect={(id) => changeSession(() => mutateSession({ action: "select-window", windowId: id }))}
          onNew={() => changeSession(() => mutateSession({ action: "new-window" }))}
          onClose={(id) => changeSession(() => mutateSession({ action: "close-window", windowId: id }))}
        />
      )}
      {running && !inSettings && session.windows.length > 0 && (
        <TabBar
          tabs={tabs}
          canCloseTab={canCloseTab}
          onSelect={(id) => changeSession(() => mutateSession({ action: "select-tab", tabId: id }))}
          onNew={() =>
            changeSession(() =>
              mutateSession({ action: "new-tab", windowId: session.activeWindowId || undefined }),
            )
          }
          onClose={(id) => changeSession(() => mutateSession({ action: "close-tab", tabId: id }))}
        />
      )}
      <AddressBar
        value={address}
        busy={busy}
        canNavigate={running && !inSettings}
        onChange={setAddress}
        onSubmit={go}
        onBack={() => perform("back")}
        onForward={() => perform("forward")}
        onReload={() => perform("reload")}
        inSettings={inSettings}
        onToggleSettings={() => setInSettings((open) => !open)}
      />

      {!running && status !== null && (
        <StartupBanner status={status} retrying={starting} onRetry={() => void begin()} />
      )}
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {inSettings ? (
        <Settings onStatus={setStatus} onError={(err) => setError(asApiError(err))} />
      ) : running && session.activeTabId !== "" ? (
        <Viewport
          key={session.activeTabId}
          liveView={status?.liveView !== false}
          onIdentity={(next) => {
            applyUrl(next.url);
            if (next.tabId !== "" && next.tabId !== session.activeTabId) {
              void fetchSession().then(applySession).catch(() => {
                // The next poll retries.
              });
            }
          }}
        />
      ) : (
        <div class="empty">
          <h1>Welcome to my browser</h1>
          <p>Type a URL or a search above, then press Enter.</p>
        </div>
      )}
    </div>
  );
}
