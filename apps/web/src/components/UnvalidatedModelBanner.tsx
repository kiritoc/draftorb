/**
 * @draftorb/web — Unvalidated model banner (D-023, T-034).
 *
 * Shown when there is no backtest report with log-loss significantly better
 * than baseline-only. Fetches the backtest report published by `pnpm etl
 * backtest draft`.
 */

import { useEffect, useState } from 'react';
import { backtestPassedValidation } from '../data/backtest-validation.js';
import { strings } from '../strings.js';

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
        setShow(!backtestPassedValidation(await response.json()));
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
      <strong>{strings.unvalidatedTitle}</strong> {strings.unvalidatedBody}
    </div>
  );
}
