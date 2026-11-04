/**
 * @draftorb/etl — Exported `role-prob.json`.
 *
 * D1: the exported values are the stored `role_prob.prob` for rows that pass the
 * `exportMinGames` gate, then renormalized so each champion's surviving
 * probabilities sum to 1. DATA_MODEL.md requires each champion's probabilities
 * to sum to 1 (tolerance 1e-6), and the engine's `inferRoles` expects sparse
 * maps summing to 1. Gating can drop roles and break that invariant, so we
 * renormalize the surviving *stored* probabilities rather than re-emitting raw
 * stored values. Documented here and in the test name
 * (`exports role-prob.json ... renormalizes survivors to sum to 1`).
 */

import { championRoleProbabilitiesSchema, roleSchema } from '@draftorb/shared';
import { passesGate, round6 } from './io.js';

export interface RoleProbRow {
  championId: number;
  role: string;
  gamesW: number;
  gamesW2: number;
  prob: number;
}

/** Exports the stored `prob` for gated-in rows, renormalized per champion to sum to 1. */
export function exportRoleProbabilities(
  rows: readonly RoleProbRow[],
  exportMinGames: number,
): Record<string, Record<string, number>> {
  const survivors = new Map<string, Array<{ role: string; prob: number }>>();
  for (const row of rows) {
    if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
    const entry = survivors.get(String(row.championId)) ?? [];
    entry.push({ role: row.role, prob: row.prob });
    survivors.set(String(row.championId), entry);
  }

  const out: Record<string, Record<string, number>> = {};
  for (const [championId, entries] of survivors) {
    let total = 0;
    for (const e of entries) total += e.prob;
    if (total <= 0) continue;
    // The largest surviving probability absorbs the rounding residual so the
    // adjusted role is always the dominant one (B-049).
    let residualIndex = 0;
    entries.forEach((e, index) => {
      if (e.prob > (entries[residualIndex]?.prob ?? 0)) residualIndex = index;
    });
    const probs: Record<string, number> = {};
    let assigned = 0;
    const values = entries.map((e, index) => {
      try {
        roleSchema.parse(e.role);
      } catch (error: unknown) {
        throw new Error(
          `Invalid role-prob export for role-prob.json (champion ${championId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (index === residualIndex) return 0;
      const value = round6(e.prob / total);
      assigned += value;
      return value;
    });
    entries.forEach((e, index) => {
      probs[e.role] = index === residualIndex ? round6(1 - assigned) : (values[index] ?? 0);
    });
    out[championId] = probs;
  }
  try {
    return championRoleProbabilitiesSchema.parse(out);
  } catch (error: unknown) {
    throw new Error(
      `Invalid role-prob export for role-prob.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function roleProbFile(
  rows: readonly RoleProbRow[],
  exportMinGames: number,
): { relativePath: string; content: string } {
  const out = exportRoleProbabilities(rows, exportMinGames);
  return { relativePath: 'role-prob.json', content: JSON.stringify(out) };
}
