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
