import type { PageView } from "../api";

interface Props {
  view: PageView;
  busy: boolean;
  onScroll(direction: "up" | "down"): void;
}

/**
 * The page as an image, plus the scroll controls that move it.
 *
 * The capture is a still, not a live surface: the browser backend takes
 * screenshots and exposes interaction by element id, with nothing that maps a
 * click at (x, y) back to a node. So the image is deliberately not clickable —
 * pretending otherwise would produce clicks that silently land nowhere — and
 * interaction lives in the element rail next to it. Scrolling is the exception,
 * because it needs no target.
 */
export function Viewport({ view, busy, onScroll }: Props) {
  return (
    <div class="viewport">
      {view.screenshot === null ? (
        <div class="viewport-fallback">
          <p>
            {view.screenshotError ??
              "The browser did not return an image for this page."}
          </p>
          <p class="muted">
            The element list and the Text tab still work — a page can be readable and
            interactive even when it will not render a capture.
          </p>
        </div>
      ) : (
        <img
          class="capture"
          src={`data:${view.screenshot.mediaType};base64,${view.screenshot.data}`}
          alt={
            view.title === ""
              ? "Screenshot of the current page"
              : `Screenshot of ${view.title}`
          }
        />
      )}

      <div class="scroll-controls">
        <button
          type="button"
          class="icon-button"
          onClick={() => onScroll("up")}
          disabled={busy}
          aria-label="Scroll up"
          title="Scroll up"
        >
          <Arrow direction="up" />
        </button>
        <button
          type="button"
          class="icon-button"
          onClick={() => onScroll("down")}
          disabled={busy}
          aria-label="Scroll down"
          title="Scroll down"
        >
          <Arrow direction="down" />
        </button>
      </div>

      {busy && <div class="loading-veil" aria-hidden="true" />}
    </div>
  );
}

function Arrow({ direction }: { direction: "up" | "down" }) {
  const path = direction === "up" ? "M3 10l5-5 5 5" : "M3 6l5 5 5-5";
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
