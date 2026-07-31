import type { StatusBody } from "../api";

interface Props {
  status: StatusBody;
}

/**
 * What the browser is doing before the first page is open.
 *
 * A plugin's dependencies install with `--ignore-scripts`, so Playwright's
 * browser download never runs and a fresh install genuinely has no Chromium
 * until the plugin fetches one. That is a several-minute wait the first time,
 * and saying so beats an address bar that appears to do nothing.
 */
export function StartupBanner({ status }: Props) {
  if (status.source === "none") {
    return (
      <div class="banner quiet">
        <span>
          Setting up Chromium — this happens once, and takes a few minutes. Opening a page
          will wait for it to finish.
        </span>
      </div>
    );
  }

  if (!status.running) {
    return (
      <div class="banner quiet">
        <span>
          Starting {status.source === "system-chrome" ? "Chrome" : "Chromium"} — the first
          page will wait for it.
        </span>
      </div>
    );
  }

  return (
    <div class="banner quiet">
      <span>
        Ready, using{" "}
        <code>{status.source === "system-chrome" ? "Google Chrome" : "Chrome for Testing"}</code>
      </span>
    </div>
  );
}
