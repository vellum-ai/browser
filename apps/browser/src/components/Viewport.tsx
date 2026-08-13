import { useEffect, useRef, useState } from "preact/hooks";

import { fetchFrame, sendInput } from "../api";
import type { FrameBody, PointerButton } from "../api";

interface Props {
  onIdentity(next: { url: string; title: string }): void;
}

/** Floor between frame requests. The next request starts after the last one lands. */
const FRAME_MS = 16;

/** Two mouseups inside this window are one double-click. */
const DBLCLICK_MS = 400;

/**
 * The live page.
 *
 * The picture is a stream of frames from the real Chromium, not a still that
 * the panel scrolls. Wheel, pointer, and keyboard events are forwarded to that
 * page, so scrolling happens there and the next frame shows the result.
 *
 * Clicks are mapped through the size we last told Playwright to use, not the
 * JPEG's own dimensions. Those two disagree after a resize, and using the
 * picture size is how a click in the panel landed off the page.
 */
export function Viewport({ onIdentity }: Props) {
  const stage = useRef<HTMLDivElement | null>(null);
  const size = useRef({ width: 1280, height: 800 });
  const wheel = useRef({ x: 0, y: 0, deltaX: 0, deltaY: 0, pending: false });
  const move = useRef({ x: 0, y: 0, pending: false });
  const lastClickAt = useRef(0);
  const identityRef = useRef({ url: "", title: "" });
  const onIdentityRef = useRef(onIdentity);
  onIdentityRef.current = onIdentity;

  const [frame, setFrame] = useState<FrameBody | null>(null);

  useEffect(() => {
    const node = stage.current;
    if (node === null) {
      return;
    }

    const reportSize = (width: number, height: number) => {
      if (width < 32 || height < 32) {
        return;
      }
      void sendInput({ type: "resize", width, height })
        .then((applied) => {
          size.current = { width: applied.width, height: applied.height };
        })
        .catch(() => {
          // A resize that fails is retried on the next observation.
        });
    };

    reportSize(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined) {
        reportSize(box.width, box.height);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const next = await fetchFrame();
        if (cancelled) {
          return;
        }
        setFrame(next);
        if (next.width > 0 && next.height > 0) {
          size.current = { width: next.width, height: next.height };
        }
        if (next.url !== "" && (next.url !== identityRef.current.url || next.title !== identityRef.current.title)) {
          identityRef.current = { url: next.url, title: next.title };
          onIdentityRef.current(identityRef.current);
        }
      } catch {
        // The next tick retries. A dead browser surfaces through /status.
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => {
            void tick();
          }, FRAME_MS);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const point = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const node = stage.current;
    if (node === null) {
      return { x: 0, y: 0 };
    }
    const bounds = node.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * size.current.width,
      y: ((event.clientY - bounds.top) / bounds.height) * size.current.height,
    };
  };

  const flushWheel = () => {
    const queued = wheel.current;
    if (!queued.pending) {
      return;
    }
    queued.pending = false;
    const { x, y, deltaX, deltaY } = queued;
    queued.deltaX = 0;
    queued.deltaY = 0;
    void sendInput({ type: "wheel", x, y, deltaX, deltaY }).catch(() => {
      // The next wheel event retries.
    });
  };

  const flushMove = () => {
    const queued = move.current;
    if (!queued.pending) {
      return;
    }
    queued.pending = false;
    void sendInput({ type: "move", x: queued.x, y: queued.y }).catch(() => {
      // The next move retries.
    });
  };

  useEffect(() => {
    const node = stage.current;
    if (node === null) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      // Must be non-passive: a passive listener cannot preventDefault, and the
      // panel would then try to scroll a still instead of the real page.
      event.preventDefault();
      const at = point(event);
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.current.height : 1;
      wheel.current.x = at.x;
      wheel.current.y = at.y;
      wheel.current.deltaX += event.deltaX * scale;
      wheel.current.deltaY += event.deltaY * scale;
      if (!wheel.current.pending) {
        wheel.current.pending = true;
        requestAnimationFrame(flushWheel);
      }
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const buttonOf = (event: MouseEvent): PointerButton => {
    if (event.button === 2) {
      return "right";
    }
    if (event.button === 1) {
      return "middle";
    }
    return "left";
  };

  const keyOf = (event: KeyboardEvent): string | null => {
    if (event.isComposing || event.key === "Dead") {
      return null;
    }
    if (event.key === "Meta" || event.key === "Control" || event.key === "Alt" || event.key === "Shift") {
      return null;
    }
    if (event.key.length === 1) {
      return event.key;
    }
    const parts: string[] = [];
    if (event.metaKey) {
      parts.push("Meta");
    }
    if (event.ctrlKey) {
      parts.push("Control");
    }
    if (event.altKey) {
      parts.push("Alt");
    }
    if (event.shiftKey) {
      parts.push("Shift");
    }
    parts.push(event.key);
    return parts.join("+");
  };

  return (
    <div
      ref={stage}
      class="viewport"
      tabIndex={0}
      role="application"
      aria-label="Page"
      onContextMenu={(event) => event.preventDefault()}
      onMouseMove={(event) => {
        const at = point(event);
        move.current.x = at.x;
        move.current.y = at.y;
        if (!move.current.pending) {
          move.current.pending = true;
          requestAnimationFrame(flushMove);
        }
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        stage.current?.focus();
      }}
      onMouseUp={(event) => {
        const at = point(event);
        const now = Date.now();
        const count = now - lastClickAt.current < DBLCLICK_MS ? 2 : 1;
        lastClickAt.current = now;
        void sendInput({
          type: "click",
          x: at.x,
          y: at.y,
          button: buttonOf(event),
          count,
        }).catch(() => {
          // The next click retries.
        });
      }}
      onKeyDown={(event) => {
        const key = keyOf(event);
        if (key === null) {
          return;
        }
        event.preventDefault();
        void sendInput({ type: "key", key }).catch(() => {
          // The next key retries.
        });
      }}
    >
      {frame?.screenshot ? (
        <img
          class="capture"
          src={`data:image/jpeg;base64,${frame.screenshot}`}
          alt={frame.title === "" ? "Current page" : frame.title}
          draggable={false}
          decoding="async"
        />
      ) : (
        <div class="viewport-fallback">
          <p>Waiting for the page…</p>
        </div>
      )}
    </div>
  );
}
