import type { Role } from '@draftorb/shared';

export interface MatchupConfig {
  enabled: true;
  /** `matchupShrinkK` selected by the backtest (0 = full matchup model). */
  shrinkK: number;
}

/**
 * D-128: the matchup layers run only when the backtest report explicitly
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
  const shrinkK = m['shrinkageK'];
  if (typeof shrinkK !== 'number' || !Number.isFinite(shrinkK) || shrinkK < 0) {
    return null;
  }
  return { enabled: true, shrinkK };
}
