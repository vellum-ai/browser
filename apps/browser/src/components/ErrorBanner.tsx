import type { ApiError } from "../api";

interface Props {
  error: ApiError;
  onDismiss(): void;
}

/**
 * The last failure, with its remediation hint kept separate from its message.
 *
 * Browser failures are usually actionable — a stale element id, an unresolvable
 * CLI, a timeout on a slow page — and the routes return the fix alongside the
 * reason, so both are shown rather than collapsed into one sentence.
 */
export function ErrorBanner({ error, onDismiss }: Props) {
  return (
    <div class="banner error" role="alert">
      <div>
        <strong>{error.message}</strong>
        {error.hint !== null && <p>{error.hint}</p>}
      </div>
      <button type="button" class="link-button" onClick={onDismiss} aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}
