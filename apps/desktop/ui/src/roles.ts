import type { Role } from '@draftorb/shared';
import { DEFAULT_ENABLED_ROLES, ROLE_ORDER } from './config';
import { strings } from './strings';

export interface RoleAvailability {
  enabled: boolean;
  reason?: string;
}

const MINIMAL_ROLES: readonly Role[] = ['ADC', 'MID'];

export function roleAvailability(
  enabledRoles: readonly Role[] = DEFAULT_ENABLED_ROLES,
): Record<Role, RoleAvailability> {
  const result = {} as Record<Role, RoleAvailability>;
  for (const role of ROLE_ORDER) {
    if (enabledRoles.includes(role)) {
      result[role] = { enabled: true };
    } else {
      result[role] = {
        enabled: false,
        reason: MINIMAL_ROLES.includes(role) ? strings.roleMinimal : strings.roleNeedsData,
      };
    }
  }
  return result;
}
