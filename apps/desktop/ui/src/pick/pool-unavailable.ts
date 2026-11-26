/**
 * Pool unavailable list items (port of the web helper, D-024/SPECS §7.1):
 * joins `poolUnavailable` reasons with the matching `insufficientData`
 * sample so pool champions without a score render as cards.
 */

import type { ChampionId, InsufficientDataEntry, PoolUnavailableEntry } from '@draftorb/shared';

export interface PoolUnavailableItem {
  readonly championId: ChampionId;
  readonly reason: PoolUnavailableEntry['reason'];
  readonly sample?: InsufficientDataEntry;
}

export function buildPoolUnavailableItems(
  entries: readonly PoolUnavailableEntry[],
  insufficientData: readonly InsufficientDataEntry[],
  excludeChampionId?: ChampionId,
): PoolUnavailableItem[] {
  const samples = new Map(insufficientData.map((item) => [item.championId, item]));
  return entries.flatMap((entry) => {
    if (entry.championId === excludeChampionId) return [];
    const sample = samples.get(entry.championId);
    return [
      {
        championId: entry.championId,
        reason: entry.reason,
        ...(sample !== undefined ? { sample } : {}),
      },
    ];
  });
}
