interface WindowItem {
  id: string;
  label: string;
  active: boolean;
}

interface TabItem {
  id: string;
  title: string;
  active: boolean;
}

interface WindowBarProps {
  windows: WindowItem[];
  onSelect(id: string): void;
  onNew(): void;
  onClose(id: string): void;
}

interface TabBarProps {
  tabs: TabItem[];
  canCloseTab: boolean;
  onSelect(id: string): void;
  onNew(): void;
  onClose(id: string): void;
}

/**
 * Window chips and a tab strip.
 *
 * One window and one tab always remain. Close is disabled on the last of each.
 */
export function WindowBar({ windows, onSelect, onNew, onClose }: WindowBarProps) {
  const canClose = windows.length > 1;
  return (
    <div class="windowbar" role="tablist" aria-label="Windows">
      <div class="strip">
        {windows.map((window) => (
          <div key={window.id} class={window.active ? "chip is-active" : "chip"}>
            <button
              type="button"
              class="chip-label"
              role="tab"
              aria-selected={window.active}
              onClick={() => onSelect(window.id)}
            >
              {window.label}
            </button>
            <button
              type="button"
              class="chip-close"
              aria-label={`Close ${window.label}`}
              title="Close window"
              disabled={!canClose}
              onClick={() => onClose(window.id)}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <button type="button" class="icon-button" aria-label="New window" title="New window" onClick={onNew}>
        <PlusIcon />
      </button>
    </div>
  );
}

export function TabBar({ tabs, canCloseTab, onSelect, onNew, onClose }: TabBarProps) {
  return (
    <div class="tabbar" role="tablist" aria-label="Tabs">
      <div class="strip">
        {tabs.map((tab) => (
          <div key={tab.id} class={tab.active ? "chip is-active" : "chip"}>
            <button
              type="button"
              class="chip-label"
              role="tab"
              aria-selected={tab.active}
              title={tab.title}
              onClick={() => onSelect(tab.id)}
            >
              {tab.title}
            </button>
            <button
              type="button"
              class="chip-close"
              aria-label={`Close ${tab.title}`}
              title="Close tab"
              disabled={!canCloseTab}
              onClick={() => onClose(tab.id)}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <button type="button" class="icon-button" aria-label="New tab" title="New tab" onClick={onNew}>
        <PlusIcon />
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M8 3v10M3 8h10"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path
        d="M4 4l8 8M12 4l-8 8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  );
}
