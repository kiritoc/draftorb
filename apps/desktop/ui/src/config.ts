import type { RankBucket, Role } from '@draftorb/shared';

/** Fallback while the coverage verdict is unknown (no cached data yet).
 *  The real list is computed from the export at load time (BL-050, D-126). */
export const DEFAULT_ENABLED_ROLES: Role[] = ['SUPPORT'];

/** D-126: minimum covered champions for a role to be selectable. */
export const ROLE_COVERAGE_MIN_CHAMPIONS = 50;

/** D-126: enablement is measured on the owner's rank bucket only. */
export const ROLE_COVERAGE_BUCKET: RankBucket = 'DIAMOND';

export const ROLE_ORDER: readonly Role[] = ['SUPPORT', 'TOP', 'JUNGLE', 'ADC', 'MID'];

/** Games needed before the badge shows a win rate (D-119, same threshold as D-075). */
export const RECORD_MIN_GAMES = 5;

/** Items shown first and added by each "Show more" click (SPECS §7.1). */
export const RECOMMENDATION_PAGE_SIZE = 5;

/** Maximum champions listed in the picker dropdown. */
export const PICKER_RESULT_LIMIT = 20;

/** Public aggregates tarball (BL-004/D-111, SPECS §20): no token required. */
export const PUBLIC_DATA_URL =
  'https://github.com/kiritoc/draftorb/releases/download/data-latest/aggregates.tar.gz';
