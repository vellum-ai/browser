import type { Action, PageElement, PageView, Rect } from "../api";

interface Props {
  view: PageView;
  busy: boolean;
  /** The element the rail has expanded, highlighted here to match. */
  activeEid: string | null;
  onAct(action: Action): void;
  onHoverElement(eid: string | null): void;
}

/**
 * The page, and the controls that act on it.
 *
 * Driving Playwright in-process is what makes this clickable. Every element the
 * collector found comes back with its geometry, so the capture can carry a
 * transparent hit target over each one — a click there is dispatched by element
 * id, not by guessing at a coordinate, so it lands on the element the user
 * actually pointed at.
 *
 * Boxes are positioned in percentages of the capture's own dimensions, so they
 * track the image at any rendered size without measuring anything.
 *
 * Clicking the background is a real click at that point, for the things no
 * collector can enumerate — a canvas, a map, a custom-drawn control. It is
 * disabled for a full-page capture, where the image is taller than the viewport
 * and a viewport coordinate would mean the wrong thing.
 */
export function Viewport({ view, busy, activeEid, onAct, onHoverElement }: Props) {
  const clickable = !view.fullPage && view.screenshot !== null;

  const boxFor = (element: PageElement): Rect =>
    view.fullPage ? element.pageRect : element.rect;

  const onBackgroundClick = (event: MouseEvent) => {
    if (!clickable || busy) {
      return;
    }
    const image = event.currentTarget as HTMLElement;
    const bounds = image.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }
    // Back from rendered pixels to the capture's own coordinate space, which is
    // the page's viewport in CSS pixels.
    const x = ((event.clientX - bounds.left) / bounds.width) * view.capture.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * view.capture.height;
    onAct({ action: "click-at", x: Math.round(x), y: Math.round(y) });
  };

  return (
    <div class="viewport">
      {view.screenshot === null ? (
        <div class="viewport-fallback">
          <p>{view.screenshotError ?? "The browser did not return an image for this page."}</p>
          <p class="muted">
            The element list and the Text tab still work — a page can be readable and
            interactive even when it will not render a capture.
          </p>
        </div>
      ) : (
        <div
          class={clickable ? "stage clickable" : "stage"}
          onClick={onBackgroundClick}
          onMouseLeave={() => onHoverElement(null)}
        >
          <img
            class="capture"
            src={`data:image/jpeg;base64,${view.screenshot}`}
            alt={
              view.title === ""
                ? "Screenshot of the current page"
                : `Screenshot of ${view.title}`
            }
          />
          {view.elements.map((element) => {
            const box = boxFor(element);
            return (
              <button
                key={element.eid}
                type="button"
                class={element.eid === activeEid ? "hit active" : "hit"}
                disabled={busy}
                title={`${element.role}${element.name === "" ? "" : `: ${element.name}`}`}
                aria-label={
                  element.name === "" ? `${element.role} ${element.eid}` : element.name
                }
                style={{
                  left: `${(box.x / view.capture.width) * 100}%`,
                  top: `${(box.y / view.capture.height) * 100}%`,
                  width: `${(box.width / view.capture.width) * 100}%`,
                  height: `${(box.height / view.capture.height) * 100}%`,
                }}
                onMouseEnter={() => onHoverElement(element.eid)}
                onClick={(event) => {
                  // The stage's background handler would otherwise also fire and
                  // send a second, coordinate-based click at the same point.
                  event.stopPropagation();
                  onAct({ action: "click", elementId: element.eid });
                }}
              />
            );
          })}
        </div>
      )}

      <div class="scroll-controls">
        <button
          type="button"
          class="icon-button"
          onClick={() => onAct({ action: "scroll", direction: "up" })}
          disabled={busy}
          aria-label="Scroll up"
          title="Scroll up"
        >
          <Arrow direction="up" />
        </button>
        <button
          type="button"
          class="icon-button"
          onClick={() => onAct({ action: "scroll", direction: "down" })}
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
