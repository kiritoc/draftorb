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

import { DEFAULT_CONFIG, DEFAULT_RECOMMEND_CONFIG } from '@draftorb/engine';

import { aggregateRoleProb } from '../aggregate';
import { aggregateBaseline } from '../aggregate-baseline';
import { aggregatePairTables } from '../aggregate-pairs';
import {
  draftPatchSplit,
  evaluatePatch,
  runBacktestDraft,
  type BacktestEngineData,
  type DraftRow,
  type MatchupCandidateResult,
  type MatchupExperiment,
  type MatchupShrinkageK,
} from '../backtest/draft';
import { buildRoleRecommendData, loadChampionTagsMap } from '../backtest/recommend-data';
import { ETL_CONFIG } from '../config/etl-config';
import type { Role } from '@draftorb/shared';

import { UsageError } from '../cli-args';
import { defaultManualDataDir, resolveRepoRoot, defaultPublicDataDir } from '../config/paths';
import { migrate } from '../db';
import { log, parsePositionals, type Command } from './shared';

const ALL_ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function resolveDbPathReadOnly(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
}

/**
 * Rebuild the engine's per-role inputs from the training window only. The
 * source database is attached read-only into a throwaway in-memory database
 * that holds every match except the excluded patches (the holdout patch by
 * default; D-130 train-only validation also excludes the validation patch),
 * then aggregated with the snapshot set to the last included patch — the
 * same code path as `pnpm etl aggregate`, so recency is relative to the
 * patch before the holdout (D-023).
 */
export function buildEngineData(
  dbPath: string,
  rows: readonly DraftRow[],
  extraExcludePatches: readonly string[] = [],
): BacktestEngineData {
  const { holdoutPatch, trainingPatches } = draftPatchSplit(rows);
  const excluded = new Set(
    [holdoutPatch, ...extraExcludePatches].filter((p): p is string => p !== null),
  );
  const includedPatches = trainingPatches.filter((p) => !excluded.has(p));
  const snapshotPatch = includedPatches[includedPatches.length - 1];
  if (holdoutPatch === null || snapshotPatch === undefined) {
    return { dataByRole: {} };
  }

  const memory = new Database(':memory:');
  try {
    migrate(memory);
    memory.exec(`ATTACH DATABASE '${dbPath.replaceAll("'", "''")}' AS src`);
    try {
      const excludeList = [...excluded];
      const placeholders = excludeList.map(() => '?').join(', ');
      memory
        .prepare(
          `INSERT INTO matches SELECT * FROM src.matches WHERE patch NOT IN (${placeholders})`,
        )
        .run(...excludeList);
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

/**
 * D-130 matchup experiment. `matchupShrinkK` candidates (plus 'off' =
 * matchup layers disabled) are scored on the LAST TRAINING PATCH ONLY —
 * engine data built from earlier patches — then the selected variant is
 * evaluated exactly once on the frozen holdout through the paired-bootstrap
 * gate. Returns null when there is no validation patch to select on.
 *
 * The two role sets are deliberately separate: `tuningRoles` (the requested
 * `--roles`, never derived from holdout picks) drives k selection so holdout
 * coverage cannot leak into tuning; `gateRoles` (the report's scored-covered
 * roles) scopes the holdout evaluation and gate, and is recorded as
 * `matchup.roles` — fallback-only roles cannot unlock matchup advice.
 */
export function runMatchupExperiment(
  dbPath: string,
  rows: readonly DraftRow[],
  engine: BacktestEngineData,
  tuningRoles: readonly Role[],
  gateRoles: readonly Role[],
): MatchupExperiment | null {
  const { holdoutPatch, trainingPatches } = draftPatchSplit(rows);
  const validationPatch = trainingPatches[trainingPatches.length - 1] ?? null;
  if (holdoutPatch === null || validationPatch === null) return null;

  const baseConfig = engine.config ?? DEFAULT_CONFIG;
  const engineSub = buildEngineData(dbPath, rows, [validationPatch]);
  if (Object.keys(engineSub.dataByRole).length === 0) return null;

  const candidates: MatchupShrinkageK[] = ['off', ...ETL_CONFIG.backtest.matchupShrinkKGrid];
  // Tie-break toward more shrinkage ('off' = infinite), never toward less.
  const shrinkRank = (k: MatchupShrinkageK): number => (k === 'off' ? Number.POSITIVE_INFINITY : k);
  const results: MatchupCandidateResult[] = [];
  let best: { k: MatchupShrinkageK; logLoss: number } | null = null;
  for (const k of candidates) {
    const config = {
      ...baseConfig,
      matchupEnabled: k !== 'off',
      matchupShrinkK: typeof k === 'number' ? k : 0,
    };
    const ev = evaluatePatch(rows, { ...engineSub, config }, tuningRoles, validationPatch, {
      resamples: 0,
    });
    results.push({ shrinkageK: k, logLoss: ev.logLoss });
    if (
      ev.logLoss !== null &&
      (best === null ||
        ev.logLoss < best.logLoss - 1e-12 ||
        (Math.abs(ev.logLoss - best.logLoss) <= 1e-12 && shrinkRank(k) > shrinkRank(best.k)))
    ) {
      best = { k, logLoss: ev.logLoss };
    }
  }

  if (best === null || best.k === 'off') {
    return {
      enabled: false,
      variant: 'off',
      shrinkageK: null,
      validationPatch,
      roles: [...gateRoles],
      candidates: results,
      gate: null,
    };
  }

  const k = best.k;
  const config = { ...baseConfig, matchupEnabled: true, matchupShrinkK: k };
  const holdout = evaluatePatch(rows, { ...engine, config }, gateRoles, holdoutPatch);
  const passed = holdout.gate?.passed ?? false;
  return {
    enabled: passed,
    variant: k === 0 ? 'full' : 'shrunk',
    shrinkageK: k,
    validationPatch,
    roles: [...gateRoles],
    candidates: results,
    gate: holdout.gate,
  };
}

async function runBacktest(args: string[]): Promise<void> {
  // `--out=<path>` and `--pair-adjust` are handled here, not by
  // parsePositionals: the shared helper uses strict parseArgs with no
  // options, which would reject the flags.
  const outArgs = args.filter((arg) => arg.startsWith('--out='));
  const pairAdjustArgs = args.filter((arg) => arg === '--pair-adjust');
  const roleArgs = args.filter((arg) => arg.startsWith('--roles='));
  const pairAdjust = pairAdjustArgs.length > 0;
  if (outArgs.length > 1) {
    throw new UsageError('Duplicate --out option.\nUsage: backtest draft [--out=<path>]');
  }
  if (pairAdjustArgs.length > 1) {
    throw new UsageError(
      'Duplicate --pair-adjust option.\nUsage: backtest draft [--out=<path>] [--pair-adjust]',
    );
  }
  if (roleArgs.length > 1) {
    throw new UsageError(
      'Duplicate --roles option.\nUsage: backtest draft [--out=<path>] [--roles=<TOP,JUNGLE,MID,ADC,SUPPORT>]',
    );
  }
  const rolesValue = roleArgs[0]?.slice('--roles='.length);
  let roles: Role[] | undefined;
  if (rolesValue !== undefined) {
    if (rolesValue === '') {
      throw new UsageError('Missing value for --roles.');
    }
    const parsed = rolesValue.split(',').map((r) => r.trim().toUpperCase());
    const invalid = parsed.filter((r) => !ALL_ROLES.includes(r as Role));
    if (invalid.length > 0) {
      throw new UsageError(
        `Unknown role(s) in --roles: ${invalid.join(', ')}. Valid roles: ${ALL_ROLES.join(', ')}`,
      );
    }
    roles = [...new Set(parsed as Role[])];
  }
  const positionalArgs = args.filter(
    (arg) => !arg.startsWith('--out=') && !arg.startsWith('--roles=') && arg !== '--pair-adjust',
  );
  const [subcommand] = parsePositionals(
    positionalArgs,
    1,
    'backtest draft [--out=<path>] [--pair-adjust] [--roles=<...>]',
  );
  if (subcommand !== 'draft') {
    throw new UsageError(
      `Unknown backtest subcommand "${subcommand ?? ''}". Usage: backtest draft [--out=<path>] [--pair-adjust] [--roles=<...>]`,
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
           m.avg_rank_score AS matchRankScore, p.puuid AS playerId
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id`,
      )
      .all() as DraftRow[];

    const engine = buildEngineData(dbPath, rows);
    // D-088 A/B gate: `--pair-adjust` evaluates the pair main-effect
    // adjustment without changing DEFAULT_CONFIG.
    const evaluated = pairAdjust
      ? { ...engine, config: { ...DEFAULT_CONFIG, pairMainEffectAdjust: true } }
      : engine;
    const report = runBacktestDraft(rows, evaluated, { roles });

    // D-130: the report's headline metrics stay the shadow full-matchup
    // evaluation; `matchup` carries the shrinkage experiment and decides
    // `validationStatus` (validated only when the gate passes).
    let finalReport = report;
    if (!report.insufficientData) {
      // The matchup block must validate the configuration the apps actually
      // run (DEFAULT_CONFIG + matchup flags): `--pair-adjust` is an A/B
      // experiment on the headline metrics only, so the experiment always
      // sees the unadjusted engine even when the shadow report used it.
      // It tunes on the requested roles only — never on holdout-derived
      // coverage, which would let holdout picks leak into k selection —
      // while the holdout gate covers exactly the report's scored-covered
      // roles: a requested role whose holdout picks all fell back to the
      // baseline prior carries no matchup evidence, so pooling it would
      // dilute the gate while the report's `roles` (and the web gate)
      // treat coverage as scored-only.
      // Minimal roles (ADC/MID, D-128) never run matchup layers: their zero
      // diffs would dilute the pooled gate, so they are neither tuned,
      // gated nor published in `matchup.roles`.
      const matchupEligible = (r: Role): boolean =>
        !DEFAULT_RECOMMEND_CONFIG.minimalRoles.includes(r);
      const matchup = runMatchupExperiment(
        dbPath,
        rows,
        engine,
        (roles ?? ALL_ROLES).filter(matchupEligible),
        report.roles.filter(matchupEligible),
      );
      if (matchup !== null) {
        const shadow = report.gate?.passed ? 'passed' : 'failed';
        finalReport = {
          ...report,
          matchup,
          validationStatus: matchup.enabled ? 'validated' : 'unvalidated',
          message: matchup.enabled
            ? `Backtest complete (deployed engine, full-draft holdout evaluation). Matchup layers validated on the holdout: variant ${matchup.variant}${matchup.shrinkageK !== null ? ` (matchupShrinkK=${matchup.shrinkageK})` : ''} passed the D-023 gate (validationStatus "validated"). The shadow champion-baseline gate ${shadow}. Masked drafts, rolling validation and layer ablation are not implemented.`
            : `Backtest complete (deployed engine, full-draft holdout evaluation). Matchup layers stay disabled: the train-selected variant ${matchup.variant} did not pass the D-023 gate on the holdout (validationStatus "unvalidated"). The shadow champion-baseline gate ${shadow}. Masked drafts, rolling validation and layer ablation are not implemented.`,
        };
        log.detail(
          `matchup experiment: variant=${matchup.variant} shrinkK=${matchup.shrinkageK ?? 'off'} enabled=${matchup.enabled} (train validation on ${matchup.validationPatch})`,
        );
      }
    }

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(finalReport, null, 2), 'utf8');

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
  usage: 'backtest draft [--out=<path>] [--pair-adjust] [--roles=<TOP,JUNGLE,MID,ADC,SUPPORT>]',
  description: 'Backtest the draft recommendation model on a frozen temporal holdout',
  run: runBacktest,
};
