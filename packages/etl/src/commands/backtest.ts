/**
 * @draftorb/etl — `backtest draft` command (D-023, T-027.a, B-053).
 *
 * Splits stored matches into a frozen temporal holdout (latest patch) and a
 * training window, rebuilds the deployed engine's inputs (`RecommendData`)
 * from aggregates restricted to the training window — in an in-memory
 * database, so the real aggregate tables are never touched — evaluates every
 * holdout player through `recommend` on the full draft, and writes a JSON
 * report.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { DEFAULT_CONFIG } from '@draftorb/engine';

import { aggregateRoleProb } from '../aggregate';
import { aggregateBaseline } from '../aggregate-baseline';
import { aggregatePairTables } from '../aggregate-pairs';
import {
  draftPatchSplit,
  runBacktestDraft,
  type BacktestEngineData,
  type DraftRow,
} from '../backtest/draft';
import { buildRoleRecommendData, loadChampionTagsMap } from '../backtest/recommend-data';
import { UsageError } from '../cli-args';
import { defaultManualDataDir, resolveRepoRoot, defaultPublicDataDir } from '../config/paths';
import { migrate } from '../db';
import { log, parsePositionals, type Command } from './shared';

function resolveDbPathReadOnly(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
}

/**
 * Rebuild the engine's per-role inputs from the training window only. The
 * source database is attached read-only into a throwaway in-memory database
 * that holds every match except the holdout patch, then aggregated with the
 * snapshot set to the last training patch — the same code path as
 * `pnpm etl aggregate`, so recency is relative to the patch before the
 * holdout (D-023).
 */
function buildEngineData(dbPath: string, rows: readonly DraftRow[]): BacktestEngineData {
  const { holdoutPatch, trainingPatches } = draftPatchSplit(rows);
  const snapshotPatch = trainingPatches[trainingPatches.length - 1];
  if (holdoutPatch === null || snapshotPatch === undefined) {
    return { dataByRole: {} };
  }

  const memory = new Database(':memory:');
  try {
    migrate(memory);
    memory.exec(`ATTACH DATABASE '${dbPath.replaceAll("'", "''")}' AS src`);
    try {
      memory
        .prepare('INSERT INTO matches SELECT * FROM src.matches WHERE patch <> ?')
        .run(holdoutPatch);
      memory
        .prepare(
          `INSERT INTO participants SELECT * FROM src.participants
           WHERE match_id IN (SELECT match_id FROM matches)`,
        )
        .run();
      // The training-window aggregates resolve labels through `patches`
      // (D-043); copy the catalog into the in-memory database so the live
      // table is never touched (D-055).
      const hasPatches = memory
        .prepare(`SELECT 1 FROM src.sqlite_master WHERE type = 'table' AND name = 'patches'`)
        .get();
      if (hasPatches !== undefined) {
        memory
          .prepare(
            `INSERT INTO patches (patch_index, version_label)
             SELECT patch_index, version_label FROM src.patches`,
          )
          .run();
      }
    } finally {
      memory.exec('DETACH DATABASE src');
    }

    aggregateRoleProb(memory, { patch: snapshotPatch });
    aggregateBaseline(memory, { patch: snapshotPatch });
    aggregatePairTables(memory, { patch: snapshotPatch });

    const championIds = [
      ...new Set<number>([
        ...(
          memory.prepare('SELECT DISTINCT champion_id AS id FROM participants').all() as Array<{
            id: number;
          }>
        ).map((r) => r.id),
        ...rows.map((r) => r.championId),
      ]),
    ].sort((a, b) => a - b);

    const tags = loadChampionTagsMap(join(defaultManualDataDir(), 'champion-tags.json'));
    const dataByRole = buildRoleRecommendData(memory, {
      exportMinGames: DEFAULT_CONFIG.exportMinGames,
      tags,
      championIds,
    });
    return { dataByRole };
  } finally {
    memory.close();
  }
}

async function runBacktest(args: string[]): Promise<void> {
  // `--out=<path>` is handled here, not by parsePositionals: the shared helper
  // uses strict parseArgs with no options, which would reject the flag.
  const outArgs = args.filter((arg) => arg.startsWith('--out='));
  if (outArgs.length > 1) {
    throw new UsageError('Duplicate --out option.\nUsage: backtest draft [--out=<path>]');
  }
  const positionalArgs = args.filter((arg) => !arg.startsWith('--out='));
  const [subcommand] = parsePositionals(positionalArgs, 1, 'backtest draft [--out=<path>]');
  if (subcommand !== 'draft') {
    throw new UsageError(
      `Unknown backtest subcommand "${subcommand ?? ''}". Usage: backtest draft [--out=<path>]`,
    );
  }

  const outValue = outArgs[0]?.slice('--out='.length);
  if (outArgs.length === 1 && (outValue === undefined || outValue === '')) {
    throw new UsageError('Missing value for --out.\nUsage: backtest draft [--out=<path>]');
  }
  const out =
    outValue !== undefined && outValue !== ''
      ? outValue
      : join(process.env.DRAFTORB_PUBLIC_DIR ?? defaultPublicDataDir(), 'backtest-draft.json');

  const dbPath = resolveDbPathReadOnly();
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
    const report = runBacktestDraft(rows, engine);

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

    log.info(`Backtest draft report written to ${out}`);
    log.detail(`holdout patch: ${report.holdoutPatch ?? 'none'}`);
    log.detail(`training games: ${report.trainingGames}, holdout games: ${report.holdoutGames}`);
    if (report.logLoss !== null) {
      log.detail(
        `log-loss: ${report.logLoss.toFixed(4)} (champion baseline-only ${(report.baselineLogLoss ?? 0).toFixed(4)})`,
      );
      log.detail(
        `Brier: ${(report.brier ?? 0).toFixed(4)} (baseline-only ${(report.baselineBrier ?? 0).toFixed(4)})`,
      );
      log.detail(`predictions: ${report.predictions} (${report.unscored} unscored)`);
    } else {
      log.detail(`insufficient data: ${report.message}`);
    }
  } finally {
    db.close();
  }
}

export const backtestCommand: Command = {
  name: 'backtest',
  usage: 'backtest draft [--out=<path>]',
  description: 'Backtest the draft recommendation model on a frozen temporal holdout',
  run: runBacktest,
};
