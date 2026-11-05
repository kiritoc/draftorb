/**
 * @draftorb/web — Champion availability per draft slot.
 *
 * A champion already picked in one slot cannot be picked again in another
 * (a real draft never has duplicates). The slot's own current pick stays in
 * the list so the picker can still display it.
 */

import { type Champion, type ChampionId } from '@draftorb/shared';

export function championsForSlot(
  champions: readonly Champion[],
  usedIds: ReadonlySet<ChampionId>,
  ownChampionId: ChampionId | null,
): Champion[] {
  return champions.filter(
    (champion) => champion.id === ownChampionId || !usedIds.has(champion.id),
  );
}
