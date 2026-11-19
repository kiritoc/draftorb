import type { Role } from '@draftorb/shared';

/** Roles with exported data. v1b enables more from the loaded data (BL-011). */
export const DEFAULT_ENABLED_ROLES: Role[] = ['SUPPORT'];

export const ROLE_ORDER: readonly Role[] = ['SUPPORT', 'TOP', 'JUNGLE', 'ADC', 'MID'];

/** Games needed before the badge shows a win rate (D-119, same threshold as D-075). */
export const RECORD_MIN_GAMES = 5;
