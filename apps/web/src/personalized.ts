/**
 * @draftorb/web — Personalized list pipeline (T-096, D-072).
 *
 * Glue between the unchanged overall recommendations and the engine's pure
 * `personalize()`: the user's own pick is excluded first (same rule as the
 * other lists), then the profile's entries are computed for the resolved
 * draft context. Kept as a pure function so the exclusion invariant is
 * unit-testable without rendering the screen.
 */

import { personalize, personalizeContext, type PersonalizedEntry } from '@draftorb/engine';
import type {
  ChampionId,
  DraftInput,
  ProfileExport,
  Recommendation,
  RecommendData,
} from '@draftorb/shared';

import { excludePick, type ExcludedRanks } from './data/exclude-pick.js';

export function computePersonalizedEntries(
  recommendations: readonly Recommendation[],
  profile: ProfileExport,
  draftInput: DraftInput,
  data: RecommendData,
  userChampionId: ChampionId | null,
  removedRanks: ExcludedRanks,
  nowMs: number,
): readonly PersonalizedEntry[] {
  const visible = excludePick(recommendations, userChampionId, removedRanks);
  const context = personalizeContext(draftInput, data);
  return personalize(visible, profile, context, data, nowMs).entries;
}
