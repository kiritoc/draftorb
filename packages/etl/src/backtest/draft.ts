/**
 * @draftorb/etl — Draft backtest harness (D-023, T-027.a, B-053).
 *
 * Pure, deterministic backtest of the deployed draft recommendation engine.
 * Splits stored matches into a frozen temporal holdout (latest patch) and a
 * training window (earlier patches); the caller builds per-role
 * `RecommendData` from aggregates restricted to the training window. For
 * every holdout participant the backtest runs `recommend` on the full draft
 * (every other pick known with its fixed role — the "full draft" variant of
 * D-023) and reads the score assigned to the champion the player actually
 * picked. Picks the engine cannot score fall back to the champion's
 * baseline-only prior so the comparison stays paired. Metrics are
 * per-player log-loss / Brier / calibration against that champion-baseline
 * model. Masked drafts, rolling validation and the paired-bootstrap gate
 * remain outstanding (report stays `unvalidated`).
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import {
  DEFAULT_CONFIG,
  DEFAULT_RECOMMEND_CONFIG,
  RANK_BUCKET_ORDER,
  baselinePrior,
  recommend,
  toEquivalentCounts,
  type RankWeightingConfig,
  type RecommendConfig,
} from '@draftorb/engine';
import type { DraftInput, Rank, RankBucket, RecommendData, Role, Slot } from '@draftorb/shared';
import { comparePatches } from '../matches-store';
import { gameBucketIndex } from '../aggregate-shared';

export interface DraftRow {
  matchId: string;
  patch: string;
  teamId: number;
  championId: number;
  role: Role;
  win: number; // 1 when this participant's team won the match
  /** Match average rank score (D-019), the same rank context used by aggregates. */
  matchRankScore: number;
}

/** Per-role engine inputs built from the training window (never the holdout). */
export interface BacktestEngineData {
  readonly dataByRole: Readonly<Partial<Record<Role, RecommendData>>>;
  readonly config?: RankWeightingConfig;
  readonly recommendConfig?: RecommendConfig;
}

interface CalibrationBin {
  bin: number;
  meanPred: number;
  meanActual: number;
  count: number;
}

export interface RoleMetrics {
  predictions: number;
  unscored: number;
  meanPred: number | null;
  meanActual: number | null;
  logLoss: number | null;
  brier: number | null;
}

export interface BacktestReport {
  holdoutPatch: string | null;
  trainingPatches: string[];
  holdoutGames: number;
  trainingGames: number;
  /** Player-level predictions evaluated (one per scored holdout participant). */
  predictions: number;
  /** Predictions where the engine had no score and the baseline prior was used. */
  unscored: number;
  logLoss: number | null;
  brier: number | null;
  baselineLogLoss: number | null;
  baselineBrier: number | null;
  calibration: CalibrationBin[];
  perRole: Record<Role, RoleMetrics>;
  insufficientData: boolean;
  validationStatus: 'unvalidated';
  message: string;
}

const MIN_TRAINING_GAMES = 5;
const N_BINS = 10;
const ALL_ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

/** `rankScore` scale: integer part = RANK_BUCKET_ORDER index (6.5 = DIAMOND). */
function scoreToBucket(rankScore: number): RankBucket {
  return RANK_BUCKET_ORDER[gameBucketIndex(rankScore)] as RankBucket;
}

/** Inverse of the engine's `rankToBucket` for evaluation inputs. */
const BUCKET_TO_RANK: Record<RankBucket, Rank> = {
  IRON: 'IRON',
  BRONZE: 'BRONZE',
  SILVER: 'SILVER',
  GOLD: 'GOLD',
  PLATINUM: 'PLATINUM',
  EMERALD: 'EMERALD',
  DIAMOND: 'DIAMOND',
  MASTER_PLUS: 'MASTER',
};

function clamp(p: number): number {
  return Math.min(Math.max(p, 1e-6), 1 - 1e-6);
}

function logLossBinary(pred: number, actual: number): number {
  const p = clamp(pred);
  return -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
}

function brierBinary(pred: number, actual: number): number {
  const d = pred - actual;
  return d * d;
}

function groupByMatch(rows: DraftRow[]): Map<string, DraftRow[]> {
  const byMatch = new Map<string, DraftRow[]>();
  for (const row of rows) {
    const list = byMatch.get(row.matchId) ?? [];
    list.push(row);
    byMatch.set(row.matchId, list);
  }
  return byMatch;
}

/** Frozen temporal split: latest stored patch is the holdout, the rest train. */
export function draftPatchSplit(rows: readonly DraftRow[]): {
  holdoutPatch: string | null;
  trainingPatches: string[];
} {
  const patches = [...new Set(rows.map((r) => r.patch))].sort(comparePatches);
  return {
    holdoutPatch: patches[patches.length - 1] ?? null,
    trainingPatches: patches.slice(0, -1),
  };
}

/**
 * Champion-baseline-only prediction: the shrunk baseline prior `p0` for
 * (champion, rank bucket) from the role's exported baseline table — the same
 * prior the engine starts from before matchup layers. Missing rows predict
 * 0.5, matching `baselinePrior` on empty evidence.
 */
function championBaseline(
  data: RecommendData,
  championId: number,
  bucket: RankBucket,
  k0: number,
): number {
  for (const [c, rowBucket, winsW, gamesW, gamesW2] of data.baselines) {
    if (c !== championId || rowBucket !== bucket) continue;
    const { winsE, gamesE } = toEquivalentCounts(winsW, gamesW, gamesW2);
    return baselinePrior(winsE, gamesE, k0);
  }
  return baselinePrior(0, 0, k0);
}

interface PlayerPoint {
  pred: number;
  baseline: number;
  actual: number;
  role: Role;
  scored: boolean;
}

/** Slots for the other players of the match on `teamId`, with known roles. */
function teamSlots(rows: readonly DraftRow[], self: DraftRow, teamId: number): Slot[] {
  return rows
    .filter((r) => r !== self && r.teamId === teamId)
    .map((r) => ({ championId: r.championId, role: r.role }));
}

/** Slots for every player not on `teamId` (the enemy team). */
function enemySlots(rows: readonly DraftRow[], self: DraftRow, teamId: number): Slot[] {
  return rows
    .filter((r) => r !== self && r.teamId !== teamId)
    .map((r) => ({ championId: r.championId, role: r.role }));
}

function evaluatePlayer(
  row: DraftRow,
  matchRows: readonly DraftRow[],
  engine: BacktestEngineData,
): PlayerPoint | null {
  const data = engine.dataByRole[row.role];
  if (data === undefined) return null;

  const bucket = scoreToBucket(row.matchRankScore);
  const input: DraftInput = {
    userRank: BUCKET_TO_RANK[bucket],
    userRole: row.role,
    allies: teamSlots(matchRows, row, row.teamId),
    enemies: enemySlots(matchRows, row, row.teamId),
    blindPick: false,
  };
  const config = engine.config ?? DEFAULT_CONFIG;
  const rc = engine.recommendConfig ?? DEFAULT_RECOMMEND_CONFIG;
  const result = recommend(input, data, config, rc);
  const picked = result.recommendations.find((r) => r.championId === row.championId);

  const baseline = championBaseline(data, row.championId, bucket, config.k0);
  return {
    pred: picked?.score ?? baseline,
    baseline,
    actual: row.win,
    role: row.role,
    scored: picked !== undefined,
  };
}

function calibrationBins(
  points: ReadonlyArray<{ pred: number; actual: number }>,
): CalibrationBin[] {
  const bins: Array<{ pred: number[]; actual: number[] }> = Array.from({ length: N_BINS }, () => ({
    pred: [],
    actual: [],
  }));
  for (const { pred, actual } of points) {
    const bin = Math.min(N_BINS - 1, Math.floor(pred * N_BINS));
    const bucket = bins[bin];
    if (!bucket) continue;
    bucket.pred.push(pred);
    bucket.actual.push(actual);
  }
  return bins.map((b, index) => {
    if (b.pred.length === 0) {
      return { bin: index, meanPred: 0, meanActual: 0, count: 0 };
    }
    const meanPred = b.pred.reduce((a, b) => a + b, 0) / b.pred.length;
    const meanActual = b.actual.reduce((a, b) => a + b, 0) / b.actual.length;
    return { bin: index, meanPred, meanActual, count: b.pred.length };
  });
}

function emptyRoleMetrics(): RoleMetrics {
  return {
    predictions: 0,
    unscored: 0,
    meanPred: null,
    meanActual: null,
    logLoss: null,
    brier: null,
  };
}

function insufficient(
  partial: Pick<
    BacktestReport,
    'holdoutPatch' | 'trainingPatches' | 'holdoutGames' | 'trainingGames'
  >,
  message: string,
): BacktestReport {
  return {
    ...partial,
    predictions: 0,
    unscored: 0,
    logLoss: null,
    brier: null,
    baselineLogLoss: null,
    baselineBrier: null,
    calibration: [],
    perRole: Object.fromEntries(ALL_ROLES.map((r) => [r, emptyRoleMetrics()])) as Record<
      Role,
      RoleMetrics
    >,
    insufficientData: true,
    validationStatus: 'unvalidated',
    message,
  };
}

function insufficientWithFallbackCounts(
  partial: Pick<
    BacktestReport,
    'holdoutPatch' | 'trainingPatches' | 'holdoutGames' | 'trainingGames'
  >,
  message: string,
  points: readonly PlayerPoint[],
): BacktestReport {
  const perRole = Object.fromEntries(
    ALL_ROLES.map((role) => [role, { ...emptyRoleMetrics() }]),
  ) as Record<Role, RoleMetrics>;
  for (const point of points) {
    const metrics = perRole[point.role];
    metrics.predictions += 1;
    metrics.unscored += 1;
  }
  return {
    ...insufficient(partial, message),
    predictions: points.length,
    unscored: points.length,
    perRole,
  };
}

export function runBacktestDraft(rows: DraftRow[], engine: BacktestEngineData): BacktestReport {
  const { holdoutPatch, trainingPatches } = draftPatchSplit(rows);
  const holdoutRows = rows.filter((r) => r.patch === holdoutPatch);
  const trainingRows = rows.filter((r) => trainingPatches.includes(r.patch));
  const holdoutMatches = groupByMatch(holdoutRows);
  const trainingMatches = groupByMatch(trainingRows);
  const counts = {
    holdoutPatch,
    trainingPatches,
    holdoutGames: holdoutMatches.size,
    trainingGames: trainingMatches.size,
  };

  if (rows.length === 0) {
    return insufficient(counts, 'No matches in the database; nothing to backtest.');
  }
  if (trainingMatches.size < MIN_TRAINING_GAMES || holdoutMatches.size === 0) {
    return insufficient(
      counts,
      'Insufficient data for a backtest (need at least 5 training matches and a non-empty holdout patch).',
    );
  }
  if (Object.keys(engine.dataByRole).length === 0) {
    return insufficient(
      counts,
      'No engine recommendation data for the training window; run `pnpm etl aggregate` first.',
    );
  }

  const points: PlayerPoint[] = [];
  for (const matchRows of holdoutMatches.values()) {
    for (const row of matchRows) {
      const point = evaluatePlayer(row, matchRows, engine);
      if (point !== null) points.push(point);
    }
  }

  if (points.length === 0) {
    return insufficient(
      counts,
      'No holdout player has engine data for their role; nothing to evaluate.',
    );
  }
  if (points.every((point) => !point.scored)) {
    return insufficientWithFallbackCounts(
      counts,
      'No holdout pick was scored by the engine; only baseline fallbacks are available.',
      points,
    );
  }

  let logLoss = 0;
  let brier = 0;
  let baselineLogLoss = 0;
  let baselineBrier = 0;
  const perRole = Object.fromEntries(ALL_ROLES.map((r) => [r, emptyRoleMetrics()])) as Record<
    Role,
    RoleMetrics
  >;
  const roleAcc = new Map<
    Role,
    { n: number; unscored: number; pred: number; actual: number; ll: number; br: number }
  >();
  for (const role of ALL_ROLES) {
    roleAcc.set(role, { n: 0, unscored: 0, pred: 0, actual: 0, ll: 0, br: 0 });
  }

  for (const point of points) {
    const ll = logLossBinary(point.pred, point.actual);
    const br = brierBinary(point.pred, point.actual);
    const bll = logLossBinary(point.baseline, point.actual);
    const bbr = brierBinary(point.baseline, point.actual);
    logLoss += ll;
    brier += br;
    baselineLogLoss += bll;
    baselineBrier += bbr;

    const acc = roleAcc.get(point.role);
    if (acc !== undefined) {
      acc.n += 1;
      acc.unscored += point.scored ? 0 : 1;
      acc.pred += point.pred;
      acc.actual += point.actual;
      acc.ll += ll;
      acc.br += br;
    }
  }

  for (const [role, acc] of roleAcc) {
    perRole[role] = {
      predictions: acc.n,
      unscored: acc.unscored,
      meanPred: acc.n > 0 ? acc.pred / acc.n : null,
      meanActual: acc.n > 0 ? acc.actual / acc.n : null,
      logLoss: acc.n > 0 ? acc.ll / acc.n : null,
      brier: acc.n > 0 ? acc.br / acc.n : null,
    };
  }

  const n = points.length;
  const unscored = points.filter((p) => !p.scored).length;

  return {
    holdoutPatch,
    trainingPatches,
    holdoutGames: holdoutMatches.size,
    trainingGames: trainingMatches.size,
    predictions: n,
    unscored,
    logLoss: logLoss / n,
    brier: brier / n,
    baselineLogLoss: baselineLogLoss / n,
    baselineBrier: baselineBrier / n,
    calibration: calibrationBins(points.map(({ pred, actual }) => ({ pred, actual }))),
    perRole,
    insufficientData: false,
    validationStatus: 'unvalidated',
    message:
      'Backtest complete (deployed engine, full-draft holdout evaluation). This report is not validated: the D-023 paired-bootstrap gate, masked drafts, rolling validation and layer ablation are not implemented.',
  };
}
