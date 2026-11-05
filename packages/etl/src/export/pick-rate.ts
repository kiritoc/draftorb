/**
 * @draftorb/etl — Exported `pick-rate.json` (B-026).
 *
 * Per-role pick shares for `blindSafety`: for each role, `share(e) =
 * games_w(e, role) / sum_e games_w(e, role)` over the `role_prob` rows that
 * pass the `exportMinGames` gate (same `n_eff` rule as every other export),
 * renormalized so each role's shares sum to 1. Global like `role-prob.json`:
 * blind safety needs opponent picks for every lane-group role, not only the
 * exported `manifest.roles`.
 */

import { pickRateSchema, roleSchema, type PickRate } from '@draftorb/shared';
import { passesGate, round6 } from './io.js';
import type { RoleProbRow } from './role-prob.js';

/** Exports per-role pick shares, gated and renormalized like role-prob.json. */
export function exportPickRates(rows: readonly RoleProbRow[], exportMinGames: number): PickRate {
  const byRole = new Map<string, Array<{ championId: number; gamesW: number }>>();
  for (const row of rows) {
    if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
    try {
      roleSchema.parse(row.role);
    } catch (error: unknown) {
      throw new Error(
        `Invalid pick-rate export for pick-rate.json (role ${row.role}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const entry = byRole.get(row.role) ?? [];
    entry.push({ championId: row.championId, gamesW: row.gamesW });
    byRole.set(row.role, entry);
  }

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

  try {
    return pickRateSchema.parse(out);
  } catch (error: unknown) {
    throw new Error(
      `Invalid pick-rate export for pick-rate.json: ${error instanceof Error ? error.message : String(error)}`,
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
