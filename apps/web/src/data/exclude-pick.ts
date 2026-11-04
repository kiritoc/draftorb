/**
 * @draftorb/web — Remove the user's own pick from recommendation lists.
 *
 * The engine ranks the user's slot champion like any other candidate. Once it
 * is picked it must not be suggested, and the remaining global `rank` and
 * pool `poolRank` values are renumbered so no gaps appear. Scores and
 * relative order are unchanged (D-024).
 */

import { type ChampionId, type Recommendation } from '@draftorb/shared';

export interface ExcludedRanks {
  /** Global rank of the excluded champion, if it was ranked. */
  rank?: number;
  /** Pool rank of the excluded champion, if it was in the pool list. */
  poolRank?: number;
}

/** Ranks held by `championId` across the overall and pool lists. */
export function excludedRanks(
  championId: ChampionId | null,
  overall: readonly Recommendation[],
  pool: readonly Recommendation[],
): ExcludedRanks {
  if (championId === null) {
    return {};
  }
  const overallEntry = overall.find((r) => r.championId === championId);
  const poolEntry = pool.find((r) => r.championId === championId);
  return {
    rank: overallEntry?.rank ?? poolEntry?.rank,
    poolRank: poolEntry?.poolRank,
  };
}

/** Drops `championId` and closes the rank gaps it leaves. Pure; inputs untouched. */
export function excludePick(
  list: readonly Recommendation[],
  championId: ChampionId | null,
  removed: ExcludedRanks,
): Recommendation[] {
  if (championId === null) {
    return [...list];
  }
  return list
    .filter((r) => r.championId !== championId)
    .map((r) => {
      const shiftRank = removed.rank !== undefined && r.rank > removed.rank;
      const shiftPool =
        removed.poolRank !== undefined && r.poolRank !== undefined && r.poolRank > removed.poolRank;
      if (!shiftRank && !shiftPool) {
        return r;
      }
      const next: Recommendation = { ...r, rank: shiftRank ? r.rank - 1 : r.rank };
      if (r.poolRank !== undefined) {
        next.poolRank = shiftPool ? r.poolRank - 1 : r.poolRank;
      }
      return next;
    });
}
