/**
 * @draftorb/web — Matchup-layer config hook (D-133, BL-014).
 *
 * Resolves the engine matchup config from the backtest report once the
 * current export patch is known: the report must validate the role on the
 * exact loaded patch, otherwise the champion-baseline ranking stays on
 * (fail-safe). Shared by the draft screen and the baseline banner so both
 * always agree. Returns `undefined` while loading, `null` when the baseline
 * ranking applies, and the config when matchup layers are validated.
 */

import { useEffect, useState } from 'react';
import type { Role } from '@draftorb/shared';
import { loadLatest } from './data/loader.js';
import { loadBacktestReport } from './data/backtest-report.js';
import { matchupConfigFromReport, type MatchupConfig } from './data/backtest-validation.js';

export function useMatchupConfig(role: Role): MatchupConfig | null | undefined {
  const [config, setConfig] = useState<MatchupConfig | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [latest, report] = await Promise.all([loadLatest(), loadBacktestReport()]);
        if (!cancelled) {
          setConfig(matchupConfigFromReport(report, role, latest.patch));
        }
      } catch {
        if (!cancelled) {
          setConfig(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  return config;
}
