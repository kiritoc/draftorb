/**
 * Champion availability per draft slot (port of the web helper): a
 * champion already picked in one slot cannot be picked again; the slot's
 * own current pick stays listed so the picker can still display it.
 */

import type { Champion, ChampionId } from '@draftorb/shared';

export function championsForSlot(
  champions: readonly Champion[],
  usedIds: ReadonlySet<ChampionId>,
  ownChampionId: ChampionId | null,
): Champion[] {
  return champions.filter((champion) => champion.id === ownChampionId || !usedIds.has(champion.id));
}
