/**
 * Best-overall thin-data items (BL-017, D-103, SPECS §7): every champion that
 * failed the baseline `n_eff` gate becomes an unavailable card carrying its
 * `InsufficientDataEntry` sample, so the broader statistic renders instead of
 * nothing. Ranked order is untouched — the cards are appended after the
 * recommendations by `RecommendationsList`. The user's own pick is excluded
 * like in `buildPoolUnavailableItems`: it is not on the board, so the engine
 * still reports it as a candidate, but a locked pick must not be suggested
 * back as "not recommended".
 */

import type { ChampionId, InsufficientDataEntry } from '@draftorb/shared';
import type { UnavailableItem } from './pool-unavailable';

export function buildInsufficientItems(
  insufficientData: readonly InsufficientDataEntry[],
  excludeChampionId?: ChampionId,
): UnavailableItem[] {
  return insufficientData.flatMap((sample) => {
    if (sample.championId === excludeChampionId) return [];
    return [{ championId: sample.championId, reason: 'insufficientData' as const, sample }];
  });
}
