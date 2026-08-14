import { useEffect, useState } from "preact/hooks";

import { fetchEngines, mutateEngine } from "../api";
import type { ApiError, EngineId, EnginesBody } from "../api";

interface Props {
  onStatus(next: EnginesBody["status"]): void;
  onError(err: ApiError): void;
}

/**
 * Browser settings: which engine `POST /start` launches.
 *
 * Chromium Debugging is the shipped default and is always installed.
 * Lightpanda is optional and has no live page view.
 */
export function Settings({ onStatus, onError }: Props) {
  const [body, setBody] = useState<EnginesBody | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await fetchEngines();
        if (cancelled) {
          return;
        }
        setBody(next);
        onStatus(next.status);
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
  }, [onStatus]);

  const run = (engine: EngineId, action: "install" | "uninstall" | "set-default") => {
    const key = `${action}:${engine}`;
    setPending(key);
    void mutateEngine(engine, action)
      .then((next) => {
        setBody(next);
        onStatus(next.status);
      })
      .catch((err: unknown) => {
        onError(err as ApiError);
      })
      .finally(() => setPending(null));
  };

  return (
    <div class="settings">
      <header class="settings-header">
        <h1>Browser settings</h1>
        <p>Choose which engine this plugin launches. Chromium Debugging is the default.</p>
      </header>

      <section class="settings-section" aria-labelledby="engines-heading">
        <h2 id="engines-heading">Engines</h2>
        <div class="engine-list">
          {(body?.engines ?? []).map((engine) => {
            const busy = pending !== null || engine.installing;
            const isPending = (action: string) => pending === `${action}:${engine.id}`;
            return (
              <article key={engine.id} class={engine.isDefault ? "engine-card is-default" : "engine-card"}>
                <div class="engine-copy">
                  <h3>{engine.label}</h3>
                  <p class="engine-status">
                    {engine.installing
                      ? "Installing"
                      : engine.installed
                        ? "Installed"
                        : engine.available
                          ? "Not installed"
                          : "Unavailable"}
                    {engine.isDefault ? " · Default" : ""}
                  </p>
                  {engine.note !== null && <p class="engine-note">{engine.note}</p>}
                </div>
                <div class="engine-actions">
                  {engine.id === "lightpanda" && engine.available && !engine.installed && (
                    <button
                      type="button"
                      class="row-action primary"
                      disabled={busy}
                      onClick={() => run("lightpanda", "install")}
                    >
                      {isPending("install") || engine.installing ? "Installing…" : "Install"}
                    </button>
                  )}
                  {engine.id === "lightpanda" && engine.installed && (
                    <button
                      type="button"
                      class="row-action"
                      disabled={busy}
                      onClick={() => run("lightpanda", "uninstall")}
                    >
                      {isPending("uninstall") ? "Removing…" : "Uninstall"}
                    </button>
                  )}
                  <button
                    type="button"
                    class="row-action"
                    disabled={busy || engine.isDefault || !engine.installed}
                    onClick={() => run(engine.id, "set-default")}
                  >
                    {engine.isDefault ? "Default" : isPending("set-default") ? "Switching…" : "Set as default"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
