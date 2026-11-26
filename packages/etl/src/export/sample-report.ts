/**
 * @draftorb/etl — Per-file sample-size report for exported role data (BL-011).
 *
 * Every file under `roles/<ROLE>/` carries weighted rows (`games_w`,
 * `games_w2`); the effective sample size of a row is
 * `n_eff = games_w^2 / games_w2` (SPECS §3). This module measures the
 * exported JSON — not the database — so the report reflects exactly what a
 * consumer downloads, and it can run on any published patch directory
 * (`pnpm etl sample-report`), including one fetched via `pnpm etl pull`.
 *
 * Row granularity: one stat row per exported evidence unit — a tuple in the
 * five role tables, a page in `runes/<id>.json`, an item in
 * `builds/<id>.json` / `build-paths/<id>.json`.
 */

import { nEff } from '@draftorb/engine';

/** `[gamesWIndex, gamesW2Index]` inside each role-table tuple layout
 *  (DATA_MODEL.md §Exported JSON). */
const TABLE_WEIGHT_INDICES: Readonly<Record<string, readonly [number, number]>> = {
  'baseline.json': [3, 4],
  'ally-pairs.json': [5, 6],
  'enemy-pairs.json': [5, 6],
  'lane-vs.json': [5, 6],
  'lane-full.json': [6, 7],
};

export interface SampleFileStat {
  /** Manifest-relative path, e.g. `roles/TOP/baseline.json`. */
  path: string;
  /** Number of exported evidence rows (tuples, rune pages or build items). */
  rows: number;
  nEffMin: number | null;
  nEffMedian: number | null;
  nEffMax: number | null;
}

export interface RoleSampleReport {
  role: string;
  files: SampleFileStat[];
  /** Pooled across every file of the role. */
  rows: number;
  nEffMin: number | null;
  nEffMedian: number | null;
  nEffMax: number | null;
}

export interface SampleReportEntry {
  /** Manifest-relative path (`roles/<ROLE>/...`). */
  path: string;
  /** Parsed JSON content of the file. */
  json: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects `n_eff` of every object carrying numeric `gamesW`/`gamesW2`
 *  (rune pages, build items). */
function collectObjectNEffs(value: unknown, out: number[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectNEffs(item, out);
    return;
  }
  if (!isRecord(value)) return;
  const { gamesW, gamesW2 } = value;
  if (typeof gamesW === 'number' && typeof gamesW2 === 'number') {
    out.push(nEff(gamesW, gamesW2));
  }
  for (const child of Object.values(value)) {
    collectObjectNEffs(child, out);
  }
}

function fileNEffs(path: string, json: unknown): number[] {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const indices = TABLE_WEIGHT_INDICES[basename];
  if (indices !== undefined) {
    if (!Array.isArray(json)) {
      throw new Error(`sample-report: ${path} is not a tuple array`);
    }
    const [gamesWIndex, gamesW2Index] = indices;
    return json.map((row) => {
      if (!Array.isArray(row)) {
        throw new Error(`sample-report: ${path} contains a non-tuple row`);
      }
      const gamesW = row[gamesWIndex];
      const gamesW2 = row[gamesW2Index];
      if (typeof gamesW !== 'number' || typeof gamesW2 !== 'number') {
        throw new Error(`sample-report: ${path} row is missing weight columns`);
      }
      return nEff(gamesW, gamesW2);
    });
  }
  const out: number[] = [];
  collectObjectNEffs(json, out);
  return out;
}

function summarize(nEffs: readonly number[]): {
  rows: number;
  nEffMin: number | null;
  nEffMedian: number | null;
  nEffMax: number | null;
} {
  if (nEffs.length === 0) {
    return { rows: 0, nEffMin: null, nEffMedian: null, nEffMax: null };
  }
  const sorted = [...nEffs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return {
    rows: sorted.length,
    nEffMin: sorted[0] ?? null,
    nEffMedian: median,
    nEffMax: sorted[sorted.length - 1] ?? null,
  };
}

/**
 * Builds the per-file sample-size report for every `roles/<ROLE>/` entry.
 * Entries that do not start with `roles/` are ignored. Roles are returned in
 * order of first appearance; files are sorted by path.
 */
export function buildSampleReport(entries: readonly SampleReportEntry[]): RoleSampleReport[] {
  const byRole = new Map<string, SampleReportEntry[]>();
  for (const entry of entries) {
    const match = /^roles\/([^/]+)\//.exec(entry.path);
    if (match === null) continue;
    const role = match[1];
    if (role === undefined) continue;
    const list = byRole.get(role);
    if (list === undefined) {
      byRole.set(role, [entry]);
    } else {
      list.push(entry);
    }
  }

  const reports: RoleSampleReport[] = [];
  for (const [role, roleEntries] of byRole) {
    const files: SampleFileStat[] = [];
    const pooled: number[] = [];
    for (const entry of [...roleEntries].sort((a, b) => a.path.localeCompare(b.path))) {
      const nEffs = fileNEffs(entry.path, entry.json);
      pooled.push(...nEffs);
      files.push({ path: entry.path, ...summarize(nEffs) });
    }
    reports.push({ role, files, ...summarize(pooled) });
  }
  return reports;
}
