import type { Role } from '@draftorb/shared';
import { DEFAULT_ENABLED_ROLES, ROLE_ORDER } from './config';
import { strings } from './strings';

export interface RoleAvailability {
  enabled: boolean;
  reason?: string;
}

export function roleAvailability(
  enabledRoles: readonly Role[] = DEFAULT_ENABLED_ROLES,
): Record<Role, RoleAvailability> {
  const result = {} as Record<Role, RoleAvailability>;
  for (const role of ROLE_ORDER) {
    result[role] = enabledRoles.includes(role)
      ? { enabled: true }
      : { enabled: false, reason: strings.roleNeedsData };
  }
  return result;
}

/**
 * BL-055: role the "New game" reset returns the selector to — the first
 * eligible role in ROLE_ORDER (SUPPORT first), falling back to SUPPORT
 * when the verdict enables nothing.
 */
export function defaultRole(enabledRoles: readonly Role[] = DEFAULT_ENABLED_ROLES): Role {
  return ROLE_ORDER.find((role) => enabledRoles.includes(role)) ?? 'SUPPORT';
}
