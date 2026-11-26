/**
 * Unavailable list items (port of the web helper, D-024/SPECS §7.1):
 * `buildPoolUnavailableItems` joins `poolUnavailable` reasons with the
 * matching `insufficientData` sample so pool champions without a score
 * render as cards; `UnavailableItem` is the shared card shape also used by
 * the Best-overall thin-data cards (BL-017).
 */

import type { ChampionId, InsufficientDataEntry, PoolUnavailableEntry } from '@draftorb/shared';

export interface UnavailableItem {
  readonly championId: ChampionId;
  readonly reason: PoolUnavailableEntry['reason'];
  readonly sample?: InsufficientDataEntry;
}

export function buildPoolUnavailableItems(
  entries: readonly PoolUnavailableEntry[],
  insufficientData: readonly InsufficientDataEntry[],
  excludeChampionId?: ChampionId,
): UnavailableItem[] {
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
