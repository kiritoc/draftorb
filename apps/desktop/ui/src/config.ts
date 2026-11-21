import type { Role } from '@draftorb/shared';

/** Roles with exported data. v1b enables more from the loaded data (BL-011). */
export const DEFAULT_ENABLED_ROLES: Role[] = ['SUPPORT'];

export const ROLE_ORDER: readonly Role[] = ['SUPPORT', 'TOP', 'JUNGLE', 'ADC', 'MID'];

/** Games needed before the badge shows a win rate (D-119, same threshold as D-075). */
export const RECORD_MIN_GAMES = 5;

/** Public aggregates tarball (BL-004/D-111, SPECS §20): no token required. */
export const PUBLIC_DATA_URL =
  'https://github.com/kiritoc/draftorb/releases/download/data-latest/aggregates.tar.gz';
