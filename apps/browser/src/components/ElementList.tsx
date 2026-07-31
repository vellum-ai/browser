import { useMemo, useState } from "preact/hooks";

import type { Action, PageElement } from "../api";

interface Props {
  elements: PageElement[];
  busy: boolean;
  /** The element highlighted on the capture, kept in sync with this list. */
  activeEid: string | null;
  onAct(action: Action): void;
  onHoverElement(eid: string | null): void;
}

/** Roles that take typed text. */
const TEXT_ROLES = new Set(["textbox", "searchbox", "spinbutton"]);

/** Roles that pick from a list of options. */
const OPTION_ROLES = new Set(["combobox", "listbox"]);

/** Attributes worth showing on a row, in the order they read best. */
const SHOWN_ATTRS = ["href", "placeholder", "type", "checked", "expanded", "disabled"];

/**
 * The interactive elements on the page, and the controls that act on them.
 *
 * The capture is clickable now, so this list is no longer the only way to
 * reach an element — but it is still the precise one. It names what each
 * control is, reaches things a click cannot (typing, option-picking, hover),
 * and stays usable when a page renders nothing worth pointing at.
 *
 * Hovering a row highlights the same element on the capture, and vice versa, so
 * the two views stay legible as one page rather than two lists of the same
 * thing.
 *
 * Element ids are only valid for the collection they came from. Each response
 * carries a fresh one, so the list re-renders after every action and acting on
 * a stale id fails loudly rather than hitting whatever inherited it.
 *
 * The per-row input is deliberately not a `<form>`: the app's iframe is
 * sandboxed without `allow-forms`, so a submission is blocked and its event
 * never fires. Enter is handled explicitly instead.
 */
export function ElementList({
  elements,
  busy,
  activeEid,
  onAct,
  onHoverElement,
}: Props) {
  const [filter, setFilter] = useState("");
  const [openEid, setOpenEid] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") {
      return elements;
    }
    return elements.filter((element) => {
      const haystack = [
        element.eid,
        element.role,
        element.name,
        ...Object.values(element.attrs),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [elements, filter]);

  if (elements.length === 0) {
    return (
      <div class="rail-body">
        <p class="muted pad">
          This page reports no interactive elements. Try the Text tab to read it, or scroll
          and re-check — content below the fold often loads late.
        </p>
      </div>
    );
  }

  return (
    <div class="rail-body">
      <input
        class="filter"
        type="search"
        value={filter}
        placeholder={`Filter ${elements.length} elements`}
        aria-label="Filter elements"
        onInput={(event) => setFilter(event.currentTarget.value)}
      />

      {visible.length === 0 ? (
        <p class="muted pad">Nothing matches “{filter.trim()}”.</p>
      ) : (
        <ul class="elements" onMouseLeave={() => onHoverElement(null)}>
          {visible.map((element) => (
            <ElementRow
              key={element.eid}
              element={element}
              busy={busy}
              open={openEid === element.eid}
              active={activeEid === element.eid}
              onToggle={() => setOpenEid(openEid === element.eid ? null : element.eid)}
              onHover={() => onHoverElement(element.eid)}
              onAct={onAct}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  element: PageElement;
  busy: boolean;
  open: boolean;
  active: boolean;
  onToggle(): void;
  onHover(): void;
  onAct(action: Action): void;
}

function ElementRow({ element, busy, open, active, onToggle, onHover, onAct }: RowProps) {
  const [draft, setDraft] = useState(element.value ?? "");
  const takesText = TEXT_ROLES.has(element.role);
  const takesOption = OPTION_ROLES.has(element.role);
  const label = element.name === "" ? describeUnnamed(element) : element.name;

  const attrs = SHOWN_ATTRS.filter((key) => element.attrs[key] !== undefined).map((key) => ({
    key,
    value: element.attrs[key] as string,
  }));

  /** Type-and-submit, or pick the option — whichever this row's control is. */
  const commit = () => {
    if (draft.trim() === "" || busy) {
      return;
    }
    onAct(
      takesText
        ? { action: "type", elementId: element.eid, text: draft, pressEnter: true }
        : { action: "select-option", elementId: element.eid, label: draft },
    );
  };

  const classes = ["element", open ? "open" : "", active ? "active" : ""]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <li class={classes} onMouseEnter={onHover}>
      <div class="element-head">
        <button
          type="button"
          class="element-label"
          onClick={onToggle}
          aria-expanded={open}
          title={label}
        >
          <span class="role">{element.role}</span>
          <span class="name">{label}</span>
        </button>
        {!takesText && !takesOption && (
          <button
            type="button"
            class="row-action"
            disabled={busy}
            onClick={() => onAct({ action: "click", elementId: element.eid })}
          >
            Click
          </button>
        )}
      </div>

      {open && (
        <div class="element-body">
          <div class="element-meta">
            <code>{element.eid}</code>
            {attrs.map(({ key, value }) => (
              <span key={key} class="attr" title={`${key}="${value}"`}>
                {key}=<span class="attr-value">{truncate(value, 60)}</span>
              </span>
            ))}
          </div>

          {(takesText || takesOption) && (
            <div class="element-form">
              <input
                type="text"
                value={draft}
                placeholder={takesText ? "Text to type" : "Option label"}
                aria-label={takesText ? "Text to type" : "Option label"}
                onInput={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                  }
                }}
              />
              {takesText ? (
                <>
                  <button
                    type="button"
                    class="row-action"
                    disabled={busy || draft.trim() === ""}
                    onClick={() =>
                      onAct({ action: "type", elementId: element.eid, text: draft })
                    }
                  >
                    Type
                  </button>
                  <button
                    type="button"
                    class="row-action primary"
                    disabled={busy || draft.trim() === ""}
                    onClick={commit}
                  >
                    Type + Enter
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  class="row-action primary"
                  disabled={busy || draft.trim() === ""}
                  onClick={commit}
                >
                  Select
                </button>
              )}
            </div>
          )}

          <div class="element-actions">
            <button
              type="button"
              class="row-action"
              disabled={busy}
              onClick={() => onAct({ action: "click", elementId: element.eid })}
            >
              Click
            </button>
            <button
              type="button"
              class="row-action"
              disabled={busy}
              onClick={() => onAct({ action: "hover", elementId: element.eid })}
              title="Reveal menus and tooltips that only appear on hover"
            >
              Hover
            </button>
            <button
              type="button"
              class="row-action"
              disabled={busy}
              onClick={() =>
                onAct({ action: "press-key", key: "Enter", elementId: element.eid })
              }
            >
              Enter
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * A stand-in label for an element with no accessible name. Falling back to a
 * useful attribute keeps icon buttons and bare inputs identifiable instead of
 * rendering a rail of blank rows.
 */
function describeUnnamed(element: PageElement): string {
  const candidate =
    element.attrs.placeholder ?? element.attrs.title ?? element.attrs.href ?? element.attrs.type;
  return candidate === undefined ? `(unnamed ${element.role})` : truncate(candidate, 60);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
