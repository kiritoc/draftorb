/**
 * Pick-share display model for champion cards (BL-052, D-129).
 *
 * The share comes from `pick-rate.json` and its role-wide effective sample
 * (`n_eff`) from `pick-rate-samples.json` — both computed from the same gated
 * `role_prob` rows, so the percentage and its `n` always agree. Display-only:
 * it never feeds `score(c)`, candidate selection or ranks (D-024/D-101).
 */

import { DEFAULT_CONFIG } from '@draftorb/engine';
import type { PickRate, PickRateSamples, Role } from '@draftorb/shared';

export type PickShareDisplay =
  | { readonly kind: 'rate'; readonly share: number; readonly nEff: number }
  | { readonly kind: 'insufficient'; readonly nEff: number | null };

/**
 * Resolves the pick-share figure for one (champion, role). Returns `rate`
 * only when both the share and a sample of at least `minGames` exist;
 * otherwise `insufficient` (the honest fallback, never a fabricated rate).
 * Returns `undefined` when the export has no samples file at all (legacy
 * data), so the card shows nothing instead of a misleading fallback.
 */
export function pickShareDisplay(
  role: Role,
  championId: number,
  pickRate: PickRate | undefined,
  samples: PickRateSamples | undefined,
): PickShareDisplay | undefined {
  if (samples === undefined) return undefined;
  const nEff = samples[role]?.[championId];
  const share = pickRate?.[role]?.[championId];
  if (share !== undefined && nEff !== undefined && nEff >= DEFAULT_CONFIG.minGames) {
    return { kind: 'rate', share, nEff };
  }
  return { kind: 'insufficient', nEff: nEff ?? null };
}
