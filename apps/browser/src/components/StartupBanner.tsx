import type { StatusBody } from "../api";

interface Props {
  status: StatusBody;
  /** True while a retry is in flight. */
  retrying: boolean;
  onRetry(): void;
}

/**
 * What the browser is doing before a page is open — and what to do when it is
 * doing nothing.
 *
 * A plugin's dependencies install with `--ignore-scripts`, so Playwright's
 * browser download never runs and a fresh install genuinely has no Chromium
 * until the plugin fetches one. When that fetch fails there is nothing for the
 * address bar to drive, and without this the app just sits there: the field
 * accepts a URL and nothing happens. So a failed launch shows the reason, the
 * remediation the route reported, and a button to try again.
 */
export function StartupBanner({ status, retrying, onRetry }: Props) {
  if (retrying || status.starting) {
    return (
      <div class="banner quiet">
        <span>
          {status.source === "none"
            ? "Downloading Chromium — this happens once and takes a few minutes."
            : "Starting the browser…"}
        </span>
      </div>
    );
  }

  if (status.error !== null) {
    return (
      <div class="banner error" role="alert">
        <div>
          <strong>The browser is not running.</strong>
          <p>{status.error.message}</p>
          {status.error.hint !== null && <p>{status.error.hint}</p>}
        </div>
        <button type="button" class="row-action primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (!status.running) {
    return (
      <div class="banner quiet">
        <span>
          {status.source === "none"
            ? "No Chromium yet — starting will download it, which takes a few minutes."
            : "The browser is not running yet."}
        </span>
        <button type="button" class="row-action" onClick={onRetry}>
          Start
        </button>
      </div>
    );
  }

  return (
    <div class="banner quiet">
      <span>
        Ready, using <code>{describeSource(status.source)}</code>
      </span>
    </div>
  );
}

function describeSource(source: StatusBody["source"]): string {
  if (source === "system-chrome") {
    return "Google Chrome";
  }
  if (source === "bundled-chromium") {
    return "the system Chromium";
  }
  return "Chrome for Testing";
}
