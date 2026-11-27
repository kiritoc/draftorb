/**
 * Setup-screen role enablement (BL-030b, SPECS §18.5, D-134).
 *
 * Unlike the pick screen — where enablement is the D-126 baseline-coverage
 * verdict (`role-coverage.ts`) — the setup screen enables every role the
 * manifest exports at full layout: `manifest.roles` minus
 * `manifest.minimalRoles`. Thin setup data for an enabled role is a normal
 * D-103 insufficient-data state per champion, never a disabled role.
 */

import type { Role } from '@draftorb/shared';

import { loadCachedRelease } from './export-data';

/** Roles exported at full layout (rune/build files), i.e. not minimal. */
export function setupRolesFromManifest(manifest: {
  readonly roles: readonly Role[];
  readonly minimalRoles: readonly Role[];
}): Role[] {
  const minimal = new Set<Role>(manifest.minimalRoles);
  return manifest.roles.filter((role) => !minimal.has(role));
}

/**
 * Selectable setup roles from the cached aggregate release.
 * Returns null when nothing is cached; throws on a corrupt cache, like
 * `loadEnabledRoles`.
 */
export async function loadSetupRoles(): Promise<Role[] | null> {
  const release = await loadCachedRelease();
  if (release === null) return null;
  return setupRolesFromManifest(release.manifest);
}
