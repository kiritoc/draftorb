/**
 * Best-overall thin-data items (BL-017, D-103, SPECS §7): every champion that
 * failed the baseline `n_eff` gate becomes an unavailable card carrying its
 * `InsufficientDataEntry` sample, so the broader statistic renders instead of
 * nothing. Ranked order is untouched — the cards are appended after the
 * recommendations by `RecommendationsList`.
 */

import type { InsufficientDataEntry } from '@draftorb/shared';
import type { UnavailableItem } from './pool-unavailable';

export function buildInsufficientItems(
  insufficientData: readonly InsufficientDataEntry[],
): UnavailableItem[] {
  return insufficientData.map((sample) => ({
    championId: sample.championId,
    reason: 'insufficientData',
    sample,
  }));
}
