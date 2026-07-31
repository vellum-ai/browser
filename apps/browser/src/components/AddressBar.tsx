import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  /** URL of the page currently loaded. */
  value: string;
  busy: boolean;
  /** True once a page is open, so history and reload have something to act on. */
  canNavigate: boolean;
  onChange(value: string): void;
  onSubmit(value: string): void;
  onBack(): void;
  onForward(): void;
  onReload(): void;
}

/**
 * Back, forward, reload, and the address field.
 *
 * The three buttons drive the page's own session history rather than a stack
 * this app keeps, so they stay enabled whenever a page is open: whether there
 * is anywhere to go is something only the page knows, and it answers by
 * reporting that the move did not happen.
 *
 * The field is a local draft rather than a controlled mirror of `value`: a
 * navigation can take seconds, and rewriting the input from under someone who
 * has started typing the next URL is the one thing an address bar must not do.
 * The draft resyncs when the loaded page changes and the field is not focused.
 *
 * Deliberately not a `<form>`. The app runs in an iframe sandboxed with
 * `allow-scripts` and no `allow-forms`, so the browser blocks the submission
 * outright and the `submit` event never fires — the button and the Enter key
 * would both silently do nothing. Submitting is wired to a click handler and an
 * explicit Enter key handler instead.
 */
export function AddressBar({
  value,
  busy,
  canNavigate,
  onChange,
  onSubmit,
  onBack,
  onForward,
  onReload,
}: Props) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== input.current) {
      setDraft(value);
    }
  }, [value]);

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || busy) {
      return;
    }
    onChange(trimmed);
    onSubmit(trimmed);
    input.current?.blur();
  };

  return (
    <div class="addressbar">
      <div class="nav">
        <button
          type="button"
          class="icon-button"
          onClick={onBack}
          disabled={!canNavigate || busy}
          aria-label="Back"
          title="Back"
        >
          <Chevron direction="left" />
        </button>
        <button
          type="button"
          class="icon-button"
          onClick={onForward}
          disabled={!canNavigate || busy}
          aria-label="Forward"
          title="Forward"
        >
          <Chevron direction="right" />
        </button>
        <button
          type="button"
          class="icon-button"
          onClick={onReload}
          disabled={!canNavigate || busy}
          aria-label="Reload"
          title="Reload"
        >
          <Reload />
        </button>
      </div>

      <input
        ref={input}
        class="address"
        type="text"
        value={draft}
        inputMode="url"
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        aria-label="Address"
        placeholder="Enter a URL or search"
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Enter would normally submit the form this used to be. It is not
            // one (see above), so the key is handled here.
            event.preventDefault();
            submit();
          }
          if (event.key === "Escape") {
            setDraft(value);
            input.current?.blur();
          }
        }}
      />

      <button
        type="button"
        class="go"
        onClick={submit}
        disabled={busy || draft.trim() === ""}
      >
        {busy ? "Working…" : "Open"}
      </button>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  const path = direction === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5";
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function Reload() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M13 8a5 5 0 1 1-1.6-3.7M13 2v3h-3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
