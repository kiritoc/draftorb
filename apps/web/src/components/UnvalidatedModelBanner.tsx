/**
 * @draftorb/web — Unvalidated model banner (D-023, T-034).
 *
 * Shown when there is no backtest report with log-loss significantly better
 * than baseline-only. Fetches the backtest report published by `pnpm etl
 * backtest draft`.
 */

import { useEffect, useState } from 'react';

interface BacktestReport {
  logLoss: number | null;
  baselineLogLoss: number | null;
}

export function UnvalidatedModelBanner() {
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('backtest-draft.json');
        if (!response.ok) {
          setShow(true);
          return;
        }
        const report = (await response.json()) as BacktestReport;
        const validated =
          report.logLoss != null &&
          report.baselineLogLoss != null &&
          report.logLoss < report.baselineLogLoss;
        setShow(!validated);
      } catch {
        setShow(true);
      }
    })();
  }, []);

  if (show === null || !show) {
    return null;
  }

  return (
    <div className="bg-amber-900/50 border border-amber-600/30 text-amber-300 p-3 mx-6 mb-4 rounded text-sm">
      <strong>Unvalidated model:</strong> recommendations are not backed by a backtest report with
      log-loss better than baseline-only on a frozen holdout. Use at your own risk.
    </div>
  );
}
