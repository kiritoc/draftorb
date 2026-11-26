/**
 * @draftorb/web — Baseline-ranking banner (D-128, BL-014).
 *
 * Shown while the matchup layers are disabled: the ranking is the champion
 * baseline win rate and the backtest has not validated matchup advice. The
 * banner disappears only when `backtest-draft.json` reports
 * `matchup.enabled` (fail-safe: a missing report keeps it visible).
 */

import { useEffect, useState } from 'react';
import { loadBacktestReport } from '../data/backtest-report.js';
import { matchupConfigFromReport } from '../data/backtest-validation.js';
import { strings } from '../strings.js';

export function UnvalidatedModelBanner() {
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      const report = await loadBacktestReport();
      setShow(matchupConfigFromReport(report) === null);
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
