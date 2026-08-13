/**
 * One Playwright page, one operation at a time.
 *
 * Routes run concurrently. `page.mouse` does not: a `down` and an `up` that
 * overlap never become a click, and a move that lands between them clicks
 * somewhere else. Every caller that drives the page goes through this gate.
 */

let tail: Promise<void> = Promise.resolve();

/** Run `fn` after every earlier exclusive call has settled. */
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void = () => {
    // Replaced below before `fn` runs.
  };
  const previous = tail;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(fn).finally(release);
}
