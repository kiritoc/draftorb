/**
 * @draftorb/web — Pool unavailable list items (D-024, SPECS §7.1).
 *
 * Joins `poolUnavailable` reasons with the matching `insufficientData` sample
 * so the recommendations list can render unavailable pool champions as cards
 * instead of a warning line.
 */

import type { ChampionId, InsufficientDataEntry, PoolUnavailableEntry } from '@draftorb/shared';

export interface PoolUnavailableItem {
  readonly championId: ChampionId;
  readonly reason: PoolUnavailableEntry['reason'];
  readonly sample?: InsufficientDataEntry;
}

/** Map engine pool-unavailable entries to list items, attaching sample data. */
export function buildPoolUnavailableItems(
  entries: readonly PoolUnavailableEntry[],
  insufficientData: readonly InsufficientDataEntry[],
  excludeChampionId?: ChampionId,
): PoolUnavailableItem[] {
  const samples = new Map(insufficientData.map((item) => [item.championId, item]));
  return entries.flatMap((entry) => {
    if (entry.championId === excludeChampionId) {
      return [];
    }
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
