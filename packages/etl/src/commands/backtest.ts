/**
 * @draftorb/etl — `backtest draft` command (D-023, T-027.a).
 *
 * Splits stored matches into a frozen temporal holdout (latest patch) and a
 * training window, runs the draft backtest, and writes a JSON report.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolveRepoRoot, defaultPublicDataDir } from '../config/paths';
import { runBacktestDraft, type DraftRow } from '../backtest/draft';
import { UsageError } from '../cli-args';
import { log, parsePositionals, type Command } from './shared';

function resolveDbPathReadOnly(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
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
  let out =
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
           p.champion_id AS championId, p.role AS role, p.win AS win, p.rank_score AS rankScore
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id`,
      )
      .all() as DraftRow[];

    const report = runBacktestDraft(rows);

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

    log.info(`Backtest draft report written to ${out}`);
    log.detail(`holdout patch: ${report.holdoutPatch ?? 'none'}`);
    log.detail(`training games: ${report.trainingGames}, holdout games: ${report.holdoutGames}`);
    if (report.logLoss !== null) {
      log.detail(
        `log-loss: ${report.logLoss.toFixed(4)} (baseline-only ${(report.baselineLogLoss ?? 0).toFixed(4)})`,
      );
      log.detail(
        `Brier: ${(report.brier ?? 0).toFixed(4)} (baseline-only ${(report.baselineBrier ?? 0).toFixed(4)})`,
      );
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
