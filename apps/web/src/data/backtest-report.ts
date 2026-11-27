/**
 * @draftorb/web — Backtest report loader (D-129, BL-014).
 *
 * Fetches `backtest-draft.json` once per page load and caches the promise.
 * A missing or unreadable report resolves to `null` — consumers must treat
 * that as "matchup layers off" (fail-safe).
 */

let cached: Promise<unknown> | null = null;

export function loadBacktestReport(): Promise<unknown> {
  cached ??= fetch('backtest-draft.json')
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return cached;
}
