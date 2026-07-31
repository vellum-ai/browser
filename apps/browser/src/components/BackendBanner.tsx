import { useState } from "preact/hooks";

import type { StatusBody } from "../api";

interface Props {
  status: StatusBody;
  /** True once a page is loaded, which is proof enough that a backend works. */
  collapsed: boolean;
}

/**
 * Which browser backend is serving the app, and what to do when none is.
 *
 * This is the difference between "the button didn't work" and "install the
 * Chrome extension": the status probe already returns per-backend remediation
 * steps, so when nothing is available they are rendered rather than summarized.
 * Once a page has loaded the banner collapses to a single line, because at that
 * point a backend is demonstrably working.
 */
export function BackendBanner({ status, collapsed }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (status.backendError !== null) {
    return (
      <div class="banner warn">
        <span>Could not check browser readiness: {status.backendError}</span>
      </div>
    );
  }

  const modes = status.backend?.modes ?? [];
  const available = modes.filter((mode) => mode.available);
  const recommended = status.backend?.recommendedMode ?? null;

  if (available.length === 0 && modes.length > 0) {
    const actions = modes.flatMap((mode) =>
      mode.userActions.map((action) => ({ mode: mode.mode, action })),
    );
    return (
      <div class="banner error">
        <div>
          <strong>No browser backend is available.</strong>
          <p>
            The assistant has no browser it can drive right now, so pages will not load.
          </p>
          {actions.length > 0 && (
            <ul>
              {actions.map(({ mode, action }) => (
                <li key={`${mode}:${action}`}>
                  <code>{mode}</code> {action}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (collapsed && !expanded) {
    return (
      <div class="banner quiet">
        <span>
          {recommended === null ? "Browser ready" : <>Using <code>{recommended}</code></>} ·
          session <code>{status.session}</code>
        </span>
        <button type="button" class="link-button" onClick={() => setExpanded(true)}>
          Details
        </button>
      </div>
    );
  }

  return (
    <div class="banner quiet">
      <div>
        <span>
          Session <code>{status.session}</code>, mode <code>{status.mode}</code>
          {recommended !== null && (
            <>
              , serving from <code>{recommended}</code>
            </>
          )}
        </span>
        <ul>
          {modes.map((mode) => (
            <li key={mode.mode}>
              <span class={mode.available ? "dot ok" : "dot off"} aria-hidden="true" />
              <code>{mode.mode}</code> {mode.summary}
            </li>
          ))}
        </ul>
      </div>
      {collapsed && (
        <button type="button" class="link-button" onClick={() => setExpanded(false)}>
          Hide
        </button>
      )}
    </div>
  );
}
