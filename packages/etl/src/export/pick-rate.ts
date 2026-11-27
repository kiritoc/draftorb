/**
 * @draftorb/etl — Exported `pick-rate.json` and `pick-rate-samples.json`
 * (B-026, BL-052).
 *
 * Per-role pick shares for `blindSafety` and the champion-card pick-share
 * display: for each role, `share(e) = games_w(e, role) / sum_e games_w(e,
 * role)` over the `role_prob` rows that pass the `exportMinGames` gate (same
 * `n_eff` rule as every other export), renormalized so each role's shares sum
 * to 1. `pick-rate-samples.json` carries the effective sample `n_eff` of the
 * exact same gated rows so the displayed percentage and its `n` always agree.
 * Global like `role-prob.json`: blind safety needs opponent picks for every
 * lane-group role, not only the exported `manifest.roles`.
 */

import { nEff } from '@draftorb/engine';
import {
  pickRateSamplesSchema,
  pickRateSchema,
  roleSchema,
  type PickRate,
  type PickRateSamples,
} from '@draftorb/shared';
import { passesGate, round6 } from './io.js';
import type { RoleProbRow } from './role-prob.js';

interface GatedPickRow {
  championId: number;
  gamesW: number;
  gamesW2: number;
}

/**
 * The `role_prob` rows surviving the `exportMinGames` gate, grouped by role.
 * Both pick-rate files are built from this single pass so the share and its
 * sample denominator can never diverge (BL-052).
 */
function gatedRowsByRole(
  rows: readonly RoleProbRow[],
  exportMinGames: number,
  fileName: string,
): Map<string, GatedPickRow[]> {
  const byRole = new Map<string, GatedPickRow[]>();
  for (const row of rows) {
    if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
    try {
      roleSchema.parse(row.role);
    } catch (error: unknown) {
      throw new Error(
        `Invalid pick-rate export for ${fileName} (role ${row.role}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const entry = byRole.get(row.role) ?? [];
    entry.push({ championId: row.championId, gamesW: row.gamesW, gamesW2: row.gamesW2 });
    byRole.set(row.role, entry);
  }
  return byRole;
}

/**
 * Per-role pick shares over the gated rows, before schema validation. Both
 * exports derive from this single computation so `pick-rate-samples.json`
 * carries a denominator for exactly the champions `pick-rate.json` emits —
 * a share that rounds to zero is dropped from both files (PR #168 review).
 */
function pickSharesByRole(
  byRole: Map<string, GatedPickRow[]>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [role, entries] of byRole) {
    const total = entries.reduce((acc, e) => acc + e.gamesW, 0);
    if (total <= 0) continue;
    // The largest share absorbs the rounding residual so it is always the
    // dominant pick (same rule as role-prob.json, B-049).
    let residualIndex = 0;
    entries.forEach((e, index) => {
      if (e.gamesW > (entries[residualIndex]?.gamesW ?? 0)) residualIndex = index;
    });
    const shares: Record<string, number> = {};
    let assigned = 0;
    entries.forEach((e, index) => {
      if (index === residualIndex) return;
      const value = round6(e.gamesW / total);
      if (value <= 0) return;
      shares[String(e.championId)] = value;
      assigned += value;
    });
    const residual = round6(1 - assigned);
    if (residual > 0) {
      shares[String(entries[residualIndex]?.championId ?? 0)] = residual;
    } else {
      // Pathological rounding (cannot happen with positive shares summing to 1);
      // keep the unrounded top share rather than emit an invalid map.
      const top = entries[residualIndex];
      if (top !== undefined) shares[String(top.championId)] = round6(top.gamesW / total);
    }
    out[role] = shares;
  }
  return out;
}

/** Exports per-role pick shares, gated and renormalized like role-prob.json. */
export function exportPickRates(rows: readonly RoleProbRow[], exportMinGames: number): PickRate {
  const byRole = gatedRowsByRole(rows, exportMinGames, 'pick-rate.json');
  const out = pickSharesByRole(byRole);

  try {
    return pickRateSchema.parse(out);
  } catch (error: unknown) {
    throw new Error(
      `Invalid pick-rate export for pick-rate.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Exports the effective sample (`n_eff = games_w^2 / games_w2`) behind every
 * pick share, over the same gated rows as `exportPickRates` (BL-052). Rows
 * below `exportMinGames` are excluded exactly like the share, and a gated row
 * whose share rounds to zero is excluded here too, so the two files always
 * carry the same (role, champion) keys.
 */
export function exportPickRateSamples(
  rows: readonly RoleProbRow[],
  exportMinGames: number,
): PickRateSamples {
  const byRole = gatedRowsByRole(rows, exportMinGames, 'pick-rate-samples.json');
  const shares = pickSharesByRole(byRole);

  const out: Record<string, Record<string, number>> = {};
  for (const [role, entries] of byRole) {
    const roleShares = shares[role];
    if (roleShares === undefined) continue;
    const samples: Record<string, number> = {};
    for (const e of entries) {
      const key = String(e.championId);
      if (roleShares[key] === undefined) continue;
      samples[key] = round6(nEff(e.gamesW, e.gamesW2));
    }
    if (Object.keys(samples).length > 0) out[role] = samples;
  }

  try {
    return pickRateSamplesSchema.parse(out);
  } catch (error: unknown) {
    throw new Error(
      `Invalid pick-rate export for pick-rate-samples.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** File descriptor for the compact `pick-rate.json` export. */
export function pickRateFile(
  rows: readonly RoleProbRow[],
  exportMinGames: number,
): { relativePath: string; content: string } {
  const out = exportPickRates(rows, exportMinGames);
  return { relativePath: 'pick-rate.json', content: JSON.stringify(out) };
}

/** File descriptor for the pick-share denominators (`pick-rate-samples.json`). */
export function pickRateSamplesFile(
  rows: readonly RoleProbRow[],
  exportMinGames: number,
): { relativePath: string; content: string } {
  const out = exportPickRateSamples(rows, exportMinGames);
  return { relativePath: 'pick-rate-samples.json', content: JSON.stringify(out) };
}
