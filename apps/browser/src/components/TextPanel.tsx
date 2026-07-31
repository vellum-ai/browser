import type { ExtractBody } from "../api";

interface Props {
  text: ExtractBody | null;
  busy: boolean;
  includeLinks: boolean;
  onIncludeLinks(next: boolean): void;
  onReload(): void;
}

/**
 * The page as readable text.
 *
 * A screenshot is not readable content — it cannot be selected, searched, or
 * scaled — so the extracted body is what makes the app usable for actually
 * reading a page rather than just looking at one.
 *
 * The text is page-authored. It is rendered inside a `<pre>` as literal text
 * and nothing here interprets it.
 */
export function TextPanel({ text, busy, includeLinks, onIncludeLinks, onReload }: Props) {
  return (
    <div class="rail-body">
      <div class="text-controls">
        <label class="toggle">
          <input
            type="checkbox"
            checked={includeLinks}
            disabled={busy}
            onChange={(event) => onIncludeLinks(event.currentTarget.checked)}
          />
          Include links
        </label>
        <button type="button" class="link-button" onClick={onReload} disabled={busy}>
          Re-read
        </button>
      </div>

      {busy && text === null ? (
        <p class="muted pad">Reading the page…</p>
      ) : text === null ? (
        <p class="muted pad">No text read yet.</p>
      ) : text.text.trim() === "" ? (
        <p class="muted pad">This page has no extractable text.</p>
      ) : (
        <pre class="page-text">{text.text}</pre>
      )}
    </div>
  );
}
