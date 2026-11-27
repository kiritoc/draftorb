/**
 * @draftorb/web — Baseline-ranking banner (D-130, BL-014).
 *
 * Shown while the matchup layers are disabled: the ranking is the champion
 * baseline win rate and the backtest has not validated matchup advice. The
 * banner disappears only when `backtest-draft.json` validates matchup
 * advice for the drafted role on the loaded patch — the same decision the
 * draft screen makes (fail-safe: a missing report keeps it visible).
 */

import { useMatchupConfig } from '../use-matchup-config.js';
import { strings } from '../strings.js';

const USER_ROLE = 'SUPPORT' as const;

export function UnvalidatedModelBanner() {
  const matchupConfig = useMatchupConfig(USER_ROLE);

  // undefined = still loading: wait rather than flash the banner.
  if (matchupConfig === undefined || matchupConfig !== null) {
    return null;
  }

  return (
    <div className="bg-amber-900/50 border border-amber-600/30 text-amber-300 p-3 mx-6 mb-4 rounded text-sm">
      <strong>{strings.unvalidatedTitle}</strong> {strings.unvalidatedBody}
    </div>
  );
}
