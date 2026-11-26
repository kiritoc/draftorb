/**
 * Role enablement from baseline coverage (BL-050, D-126).
 *
 * A role is selectable iff at least `ROLE_COVERAGE_MIN_CHAMPIONS` distinct
 * champions have a `roles/<ROLE>/baseline.json` row with
 * `n_eff = games_w^2 / games_w2 >= minGames` in the DIAMOND bucket — a stable
 * dataset property, independent of the rank picked in the UI. Computed at
 * load time from the exact cached files; no export format change.
 */

import { DEFAULT_CONFIG, nEff } from '@draftorb/engine';
import {
  baselineTableSchema,
  type BaselineTable,
  type Role,
} from '@draftorb/shared';

import { ROLE_COVERAGE_BUCKET, ROLE_COVERAGE_MIN_CHAMPIONS } from '../config';
import { cacheRead } from './aggregates';
import { loadCachedRelease } from './export-data';

function baselinePath(role: Role): string {
  return `roles/${role}/baseline.json`;
}

/** Distinct champions with a baseline row clearing `minGames` in the bucket. */
function coveredChampionCount(table: BaselineTable): number {
  const covered = new Set<number>();
  for (const [championId, rowBucket, , gamesW, gamesW2] of table) {
    if (rowBucket !== ROLE_COVERAGE_BUCKET) continue;
    if (nEff(gamesW, gamesW2) >= DEFAULT_CONFIG.minGames) covered.add(championId);
  }
  return covered.size;
}

/**
 * Selectable roles from a manifest file map (`file.path` -> parsed JSON).
 * A role passes when its baseline coverage reaches the threshold; a missing
 * or schema-invalid baseline counts as zero coverage (role stays disabled).
 */
export function enabledRolesFromFiles(
  files: Readonly<Record<string, unknown>>,
  roles: readonly Role[],
): Role[] {
  return roles.filter((role) => {
    const raw = files[baselinePath(role)];
    if (raw === undefined) return false;
    const parsed = baselineTableSchema.safeParse(raw);
    if (!parsed.success) return false;
    return coveredChampionCount(parsed.data) >= ROLE_COVERAGE_MIN_CHAMPIONS;
  });
}

/**
 * Computes the selectable roles from the cached aggregate release.
 * Returns null when nothing is cached (first launch, download failed);
 * throws on a corrupt cache, like `loadPickData`.
 */
export async function loadEnabledRoles(): Promise<Role[] | null> {
  const release = await loadCachedRelease();
  if (release === null) return null;
  const { latest, manifest } = release;

  const files: Record<string, unknown> = {};
  await Promise.all(
    manifest.roles.map(async (role) => {
      const raw = await cacheRead(`${latest.patch}/${baselinePath(role)}`);
      if (raw !== null) files[baselinePath(role)] = JSON.parse(raw);
    }),
  );
  return enabledRolesFromFiles(files, manifest.roles);
}
