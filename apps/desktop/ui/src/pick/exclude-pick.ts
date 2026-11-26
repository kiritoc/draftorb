/**
 * Remove the user's own pick from recommendation lists (port of the web
 * helper, D-024): the engine ranks the user-slot champion like any other
 * candidate; once picked it must not be suggested, and the remaining
 * `rank`/`poolRank` values are renumbered so no gaps appear.
 */

import type { ChampionId, Recommendation } from '@draftorb/shared';

export interface ExcludedRanks {
  rank?: number;
  poolRank?: number;
}

export function excludedRanks(
  championId: ChampionId | null,
  overall: readonly Recommendation[],
  pool: readonly Recommendation[],
): ExcludedRanks {
  if (championId === null) return {};
  const overallEntry = overall.find((r) => r.championId === championId);
  const poolEntry = pool.find((r) => r.championId === championId);
  return {
    rank: overallEntry?.rank ?? poolEntry?.rank,
    poolRank: poolEntry?.poolRank,
  };
}

export function excludePick(
  list: readonly Recommendation[],
  championId: ChampionId | null,
  removed: ExcludedRanks,
): Recommendation[] {
  if (championId === null) return [...list];
  return list
    .filter((r) => r.championId !== championId)
    .map((r) => {
      const shiftRank = removed.rank !== undefined && r.rank > removed.rank;
      const shiftPool =
        removed.poolRank !== undefined && r.poolRank !== undefined && r.poolRank > removed.poolRank;
      if (!shiftRank && !shiftPool) return r;
      const next: Recommendation = { ...r, rank: shiftRank ? r.rank - 1 : r.rank };
      if (r.poolRank !== undefined) {
        next.poolRank = shiftPool ? r.poolRank - 1 : r.poolRank;
      }
      return next;
    });
}
