/**
 * "Hide my pool" display filter (SPECS §7.1, D-024): UI-only — it removes
 * pool champions from the Best overall list without touching `score(c)`
 * or ranks, so gaps are expected while the toggle is on.
 */

import type { ChampionId, Recommendation } from '@draftorb/shared';

export function hidePoolChampions(
  recommendations: readonly Recommendation[],
  poolIds: ReadonlySet<ChampionId>,
  hideMyPool: boolean,
): Recommendation[] {
  if (!hideMyPool) return [...recommendations];
  return recommendations.filter((rec) => !poolIds.has(rec.championId));
}
