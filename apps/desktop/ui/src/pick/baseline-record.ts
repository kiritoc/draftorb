/**
 * Champion baseline win rate for the record badge (BL-051).
 *
 * Reads the same `roles/<ROLE>/baseline.json` rows the engine scores with
 * (SPECS §5 `p0`): the shrunk baseline win rate is shown only when the row
 * passes the baseline gate, so a thin sample never becomes a fake number
 * (golden rule 8, D-075/D-103). Display only — it never feeds `score(c)`.
 */

import { baselineGate, baselinePrior, DEFAULT_CONFIG, indexBaselines } from '@draftorb/engine';
import type { ChampionId } from '@draftorb/shared';

/** Per-bucket baseline lookup built once per draft (BL-051). */
export type BaselineIndex = ReturnType<typeof indexBaselines>;

export interface MetaRecord {
  /** Shrunk baseline win rate `p0` (fraction). */
  readonly winRate: number;
  /** Effective sample size `n_eff` behind the figure. */
  readonly nEff: number;
}

/**
 * Baseline win rate of `championId` in the indexed rank bucket, or null when
 * the row is missing, has no weighted evidence or fails the baseline gate.
 */
export function championMetaRecord(
  index: BaselineIndex,
  championId: ChampionId,
): MetaRecord | null {
  const row = index.get(championId);
  if (row === undefined || row.gamesE <= 0) return null;
  if (!baselineGate(row.nE, DEFAULT_CONFIG.minGames)) return null;
  return {
    winRate: baselinePrior(row.winsE, row.gamesE, DEFAULT_CONFIG.k0),
    nEff: row.nE,
  };
}
