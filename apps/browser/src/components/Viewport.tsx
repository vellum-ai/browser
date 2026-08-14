import { useEffect, useRef, useState } from "preact/hooks";

import { fetchFrame, sendInput } from "../api";
import type { Caret, FrameBody, InputResult, PointerButton } from "../api";

interface Props {
  onIdentity(next: { url: string; title: string }): void;
}

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
 *
 * The JPEG is a bitmap. Page CSS never reaches the user's pointer, so the
 * cursor and the text caret are applied here from a hit-test on the live DOM.
 *
 * Frames are painted onto a canvas the way a VNC viewer does: decode the JPEG
 * from a data URL, then `drawImage` over the pixels already there. Replacing
 * an `<img src>` is what flashes the viewport's background between frames.
 */
export function Viewport({ onIdentity }: Props) {
  const stage = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const size = useRef({ width: 1280, height: 800 });
  const lastSize = useRef({ width: 0, height: 0 });
  const wheel = useRef({ x: 0, y: 0, deltaX: 0, deltaY: 0, pending: false });
  const move = useRef({ x: 0, y: 0, pending: false });
  const lastClickAt = useRef(0);
  const identityRef = useRef({ url: "", title: "" });
  const onIdentityRef = useRef(onIdentity);
  onIdentityRef.current = onIdentity;
  const paintGen = useRef(0);
  const since = useRef(0);

  const [hasPicture, setHasPicture] = useState(false);
  const [cursor, setCursor] = useState("default");
  const [caret, setCaret] = useState<Caret | null>(null);

  const applyHit = (result: InputResult) => {
    if (result.width > 0 && result.height > 0) {
      size.current = { width: result.width, height: result.height };
    }
    if (typeof result.cursor === "string" && result.cursor !== "") {
      setCursor(result.cursor);
    }
    if (result.caret !== undefined) {
      setCaret(result.caret);
    }
  };

  useEffect(() => {
    const node = stage.current;
    if (node === null) {
      return;
    }

    const reportSize = (width: number, height: number) => {
      if (width < 32 || height < 32) {
        return;
      }
      if (
        Math.abs(width - lastSize.current.width) < 8 &&
        Math.abs(height - lastSize.current.height) < 8
      ) {
        return;
      }
      lastSize.current = { width, height };
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
      let delay = 0;
      try {
        const next = await fetchFrame(since.current);
        if (cancelled) {
          return;
        }
        applyFrame(next);
      } catch {
        delay = 100;
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => {
            void tick();
          }, delay);
        }
      }
    };

    const paint = (jpeg: string, width: number, height: number) => {
      const node = canvas.current;
      if (node === null) {
        return;
      }
      const gen = paintGen.current + 1;
      paintGen.current = gen;
      const image = new Image();
      image.onload = () => {
        if (gen !== paintGen.current) {
          return;
        }
        if (node.width !== width || node.height !== height) {
          node.width = width;
          node.height = height;
        }
        const ctx = node.getContext("2d");
        if (ctx === null) {
          return;
        }
        ctx.drawImage(image, 0, 0, width, height);
        setHasPicture(true);
      };
      image.src = `data:image/jpeg;base64,${jpeg}`;
    };

    const applyFrame = (next: FrameBody) => {
      if (next.width > 0 && next.height > 0) {
        size.current = { width: next.width, height: next.height };
      }
      if (typeof next.seq === "number" && Number.isFinite(next.seq) && next.seq > since.current) {
        since.current = next.seq;
      }
      if (next.url !== "" && (next.url !== identityRef.current.url || next.title !== identityRef.current.title)) {
        identityRef.current = { url: next.url, title: next.title };
        onIdentityRef.current(identityRef.current);
      }
      if (next.screenshot === null || next.screenshot === "") {
        return;
      }
      paint(next.screenshot, size.current.width, size.current.height);
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
    void sendInput({ type: "wheel", x, y, deltaX, deltaY })
      .then(applyHit)
      .catch(() => {
        // The next wheel event retries.
      });
  };

  const flushMove = () => {
    const queued = move.current;
    if (!queued.pending) {
      return;
    }
    queued.pending = false;
    void sendInput({ type: "move", x: queued.x, y: queued.y })
      .then(applyHit)
      .catch(() => {
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

  const clickCount = (): number => {
    const now = Date.now();
    const count = now - lastClickAt.current < DBLCLICK_MS ? 2 : 1;
    lastClickAt.current = now;
    return count;
  };

  const caretStyle = (mark: Caret): { left: string; top: string; height: string } => {
    const width = size.current.width || 1;
    const height = size.current.height || 1;
    return {
      left: `${(mark.x / width) * 100}%`,
      top: `${(mark.y / height) * 100}%`,
      height: `${(mark.height / height) * 100}%`,
    };
  };

  return (
    <div
      ref={stage}
      class="viewport"
      tabIndex={0}
      role="application"
      aria-label="Page"
      style={{ cursor }}
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
        move.current.pending = false;
        const at = point(event);
        void sendInput({
          type: "down",
          x: at.x,
          y: at.y,
          button: buttonOf(event),
          count: clickCount(),
        })
          .then(applyHit)
          .catch(() => {
            // The next press retries.
          });
      }}
      onMouseUp={(event) => {
        const at = point(event);
        void sendInput({
          type: "up",
          x: at.x,
          y: at.y,
          button: buttonOf(event),
        })
          .then(applyHit)
          .catch(() => {
            // The next release retries.
          });
      }}
      onKeyDown={(event) => {
        const key = keyOf(event);
        if (key === null) {
          return;
        }
        event.preventDefault();
        void sendInput({ type: "key", key })
          .then(applyHit)
          .catch(() => {
            // The next key retries.
          });
      }}
    >
      {hasPicture ? null : (
        <div class="viewport-fallback">
          <p>Waiting for the page…</p>
        </div>
      )}
      <canvas ref={canvas} class="capture" />
      {caret !== null ? <div class="caret" style={caretStyle(caret)} /> : null}
    </div>
  );
}
