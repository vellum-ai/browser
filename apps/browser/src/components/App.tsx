import { useCallback, useEffect, useState } from "preact/hooks";

import { ApiError, act, fetchStatus, navigate, startBrowser } from "../api";
import type { HistoryAction, StatusBody } from "../api";
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
  const [address, setAddress] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  const applyUrl = useCallback((url: string) => {
    if (url !== "") {
      setAddress(url);
    }
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
      .then((next) => applyUrl(next.url))
      .catch((err: unknown) => setError(asApiError(err)))
      .finally(() => setBusy(false));
  }, [applyUrl]);

  const perform = useCallback((action: HistoryAction) => {
    setBusy(true);
    setError(null);
    void act(action)
      .then((next) => applyUrl(next.url))
      .catch((err: unknown) => setError(asApiError(err)))
      .finally(() => setBusy(false));
  }, [applyUrl]);

  const running = status?.running === true;

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
        <Viewport onIdentity={(next) => applyUrl(next.url)} />
      ) : (
        <div class="empty">
          <h1>Welcome to my browser</h1>
          <p>Type a URL or a search above, then press Enter.</p>
        </div>
      )}
    </div>
  );
}
