/**
 * Backtest report loader for the desktop app (D-133, B-080).
 *
 * `pnpm etl publish-public` ships `backtest-draft.json` at the archive root
 * when `data/public/backtest-draft.json` exists (written by
 * `pnpm etl backtest draft`). The cached copy is only trusted while the
 * current manifest still lists it — a republish without the report leaves
 * matchup layers off even if a stale file survives in the cache.
 *
 * `matchupConfigFromReport` is a port of the web app's
 * `apps/web/src/data/backtest-validation.ts`; keep the two in sync.
 */

import type { Role } from '@draftorb/shared';

import { cacheRead } from './aggregates';
import { loadCachedRelease, manifestListsFile } from './export-data';

export interface MatchupConfig {
  enabled: true;
  /** `matchupShrinkK` selected by the backtest (0 = full matchup model). */
  shrinkK: number;
}

/**
 * D-133: the matchup layers run only when the backtest report explicitly
 * validates them (`validationStatus: 'validated'` + `matchup.enabled`) AND
 * the report covers the role being drafted AND was validated on the same
 * patch as the loaded aggregate export. Anything else — missing report,
 * invalid JSON, disabled or inconsistent `matchup` block, wrong role, or a
 * stale holdout patch — returns null and the caller keeps the
 * champion-baseline ranking (fail-safe).
 */
export function matchupConfigFromReport(
  report: unknown,
  role: Role,
  patch: string,
): MatchupConfig | null {
  if (typeof report !== 'object' || report === null) {
    return null;
  }
  const record = report as Record<string, unknown>;
  if (record['validationStatus'] !== 'validated') {
    return null;
  }
  // The gate only evaluated the roles listed in `roles`: a TOP-only report
  // says nothing about SUPPORT matchups.
  const roles = record['roles'];
  if (!Array.isArray(roles) || !roles.includes(role)) {
    return null;
  }
  // Matchups validated on an older patch must not score a newer export.
  if (record['holdoutPatch'] !== patch) {
    return null;
  }
  const matchup = record['matchup'];
  if (typeof matchup !== 'object' || matchup === null) {
    return null;
  }
  const m = matchup as Record<string, unknown>;
  if (m['enabled'] !== true) {
    return null;
  }
  // The experiment's pooled k-selection and gate cover `matchup.roles`; a
  // role missing there has no matchup evidence even if listed top-level.
  const matchupRoles = m['roles'];
  if (!Array.isArray(matchupRoles) || !matchupRoles.includes(role)) {
    return null;
  }
  const shrinkK = m['shrinkageK'];
  if (typeof shrinkK !== 'number' || !Number.isFinite(shrinkK) || shrinkK < 0) {
    return null;
  }
  return { enabled: true, shrinkK };
}

/**
 * Resolves the engine matchup config for `role` from the cached
 * `backtest-draft.json`. Returns null when the report is absent, stale or
 * does not validate the role on the loaded patch (fail-safe off).
 */
export async function loadMatchupConfig(role: Role): Promise<MatchupConfig | null> {
  const release = await loadCachedRelease();
  if (release === null) return null;
  // Optional archive file: only a manifest-listed copy is part of the
  // verified download; an unlisted cache leftover may be stale.
  if (!manifestListsFile(release.manifest, 'backtest-draft.json')) return null;
  const raw = await cacheRead('backtest-draft.json');
  if (raw === null) return null;
  let report: unknown;
  try {
    report = JSON.parse(raw);
  } catch {
    return null;
  }
  return matchupConfigFromReport(report, role, release.latest.patch);
}
