import type { Role } from '@draftorb/shared';

/** Roles with exported data. v1b enables more from the loaded data (BL-011). */
export const DEFAULT_ENABLED_ROLES: Role[] = ['SUPPORT'];

export const ROLE_ORDER: readonly Role[] = ['SUPPORT', 'TOP', 'JUNGLE', 'ADC', 'MID'];
