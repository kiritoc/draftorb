/**
 * @draftorb/etl — `tune-priors` command (Phase 1.2 of the model upgrade).
 *
 * Grid-searches the shrinkage priors (`k0`, `k`, `kLane`) on the same frozen
 * temporal holdout used by `backtest draft`, reusing the deployed engine and
 * the training-window aggregate rebuild. Each grid point is a full
 * `runBacktestDraft` evaluation; the report lists every configuration sorted
 * by holdout log-loss so the owner can pick priors with evidence instead of
 * the SPECS §3 guesses. `--role` restricts evaluation to one role's players
 * (the aggregate rebuild still covers every role, since pair tables are
 * per `my_role`). `pairMainEffectAdjust` stays at its config default — tune
 * the priors first, then A/B the flag separately.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { DEFAULT_CONFIG, type RankWeightingConfig } from '@draftorb/engine';
import { roleSchema, type Role } from '@draftorb/shared';

import { runBacktestDraft, type DraftRow } from '../backtest/draft';
import { UsageError } from '../cli-args';
import { defaultPublicDataDir, resolveRepoRoot } from '../config/paths';
import { log, parsePositionals, type Command } from './shared';
import { buildEngineData } from './backtest';

interface GridSpec {
  readonly k0: readonly number[];
  readonly k: readonly number[];
  readonly kLane: readonly number[];
}

/** Default grid: coarse sweep around the SPECS §3 priors (k0=20, k=kLane=40). */
const DEFAULT_GRID: GridSpec = {
  k0: [10, 20, 40],
  k: [20, 40, 80, 160],
  kLane: [20, 40, 80],
};

interface TuneResult {
  readonly k0: number;
  readonly k: number;
  readonly kLane: number;
  readonly s: number;
  readonly logLoss: number | null;
  readonly brier: number | null;
  readonly baselineLogLoss: number | null;
  readonly predictions: number;
  readonly unscored: number;
}

interface TuneReport {
  readonly generatedAt: string;
  readonly role: Role | 'ALL';
  readonly holdoutPatch: string | null;
  readonly trainingPatches: string[];
  readonly grid: GridSpec;
  readonly results: TuneResult[];
  readonly best: TuneResult | null;
  readonly notes: string;
}

function parseArgs(args: string[]): { role: Role | 'ALL'; out: string } {
  const roleArgs = args.filter((a) => a.startsWith('--role='));
  const outArgs = args.filter((a) => a.startsWith('--out='));
  const positional = args.filter((a) => !a.startsWith('--role=') && !a.startsWith('--out='));
  parsePositionals(positional, 0, 'tune-priors [--role=ROLE] [--out=<path>]');
  if (roleArgs.length > 1 || outArgs.length > 1) {
    throw new UsageError('Duplicate option.\nUsage: tune-priors [--role=ROLE] [--out=<path>]');
  }
  const roleValue = roleArgs[0]?.slice('--role='.length) ?? 'ALL';
  let role: Role | 'ALL' = 'ALL';
  if (roleValue !== 'ALL') {
    const parsed = roleSchema.safeParse(roleValue);
    if (!parsed.success) {
      throw new UsageError(
        `Unknown role "${roleValue}".\nUsage: tune-priors [--role=ROLE] [--out=<path>]`,
      );
    }
    role = parsed.data;
  }
  const outValue = outArgs[0]?.slice('--out='.length);
  if (outArgs.length === 1 && (outValue === undefined || outValue === '')) {
    throw new UsageError(
      'Missing value for --out.\nUsage: tune-priors [--role=ROLE] [--out=<path>]',
    );
  }
  const out =
    outValue !== undefined && outValue !== ''
      ? outValue
      : join(process.env.DRAFTORB_PUBLIC_DIR ?? defaultPublicDataDir(), `tune-priors-${role}.json`);
  return { role, out };
}

function gridConfigs(grid: GridSpec): RankWeightingConfig[] {
  const configs: RankWeightingConfig[] = [];
  for (const k0 of grid.k0) {
    for (const k of grid.k) {
      for (const kLane of grid.kLane) {
        configs.push({
          ...DEFAULT_CONFIG,
          k0,
          k,
          kLane,
        });
      }
    }
  }
  return configs;
}

async function runTunePriors(args: string[]): Promise<void> {
  const { role, out } = parseArgs(args);
  const dbPath = resolve(
    process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite'),
  );
  if (!existsSync(dbPath)) {
    log.info(`no database at ${dbPath}`);
    return;
  }

  const db: Database.Database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `SELECT
           m.match_id AS matchId, m.patch AS patch, p.team_id AS teamId,
           p.champion_id AS championId, p.role AS role, p.win AS win,
           m.avg_rank_score AS matchRankScore
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id`,
      )
      .all() as DraftRow[];

    const engine = buildEngineData(dbPath, rows);
    // Restrict evaluation to one role's players when requested; the data
    // tables stay complete so the matchup context is unchanged.
    const dataByRole =
      role === 'ALL'
        ? engine.dataByRole
        : Object.fromEntries(Object.entries(engine.dataByRole).filter(([r]) => r === role));

    const results: TuneResult[] = [];
    let holdoutPatch: string | null = null;
    let trainingPatches: string[] = [];
    for (const config of gridConfigs(DEFAULT_GRID)) {
      const bt = runBacktestDraft(rows, { dataByRole, config });
      if (holdoutPatch === null && bt.holdoutPatch !== null) {
        holdoutPatch = bt.holdoutPatch;
        trainingPatches = bt.trainingPatches;
      }
      results.push({
        k0: config.k0,
        k: config.k,
        kLane: config.kLane,
        s: config.s,
        logLoss: bt.logLoss,
        brier: bt.brier,
        baselineLogLoss: bt.baselineLogLoss,
        predictions: bt.predictions,
        unscored: bt.unscored,
      });
      log.detail(
        `k0=${config.k0} k=${config.k} kLane=${config.kLane}: log-loss ${bt.logLoss?.toFixed(4) ?? 'n/a'}`,
      );
    }

    const scored = results
      .filter((r) => r.logLoss !== null)
      .sort((a, b) => (a.logLoss ?? 0) - (b.logLoss ?? 0));
    const report: TuneReport = {
      generatedAt: new Date().toISOString(),
      role,
      holdoutPatch,
      trainingPatches,
      grid: DEFAULT_GRID,
      results,
      best: scored[0] ?? null,
      notes:
        'Grid search on the frozen temporal holdout (latest patch). ' +
        'In-sample for patch selection only — confirm with `pnpm etl backtest draft` ' +
        'before changing DEFAULT_CONFIG. pairMainEffectAdjust is not part of this grid.',
    };

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    log.info(`Tune-priors report written to ${out}`);
    if (report.best !== null) {
      log.detail(
        `best: k0=${report.best.k0} k=${report.best.k} kLane=${report.best.kLane} log-loss=${report.best.logLoss?.toFixed(4)}`,
      );
    }
  } finally {
    db.close();
  }
}

export const tunePriorsCommand: Command = {
  name: 'tune-priors',
  usage: 'tune-priors [--role=ROLE] [--out=<path>]',
  description: 'Grid-search k0/k/kLane shrinkage priors on the temporal holdout',
  run: runTunePriors,
};
