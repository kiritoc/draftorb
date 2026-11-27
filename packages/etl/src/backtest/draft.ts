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
 * model, plus the D-023 paired-bootstrap gate on holdout log-loss vs the
 * baseline-only model (resampling units `match` and `player`, fixed seed).
 * Masked drafts, rolling validation and layer ablation remain outstanding.
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
import { ETL_CONFIG } from '../config/etl-config';

export interface DraftRow {
  matchId: string;
  patch: string;
  teamId: number;
  championId: number;
  role: Role;
  win: number; // 1 when this participant's team won the match
  /** Match average rank score (D-019), the same rank context used by aggregates. */
  matchRankScore: number;
  /** Player identifier (participants.puuid); groups the player bootstrap unit.
   *  Internal only — never written to the report. */
  playerId: string;
}

/** Per-role engine inputs built from the training window (never the holdout). */
export interface BacktestEngineData {
  readonly dataByRole: Readonly<Partial<Record<Role, RecommendData>>>;
  readonly config?: RankWeightingConfig;
  readonly recommendConfig?: RecommendConfig;
}

/** D-023 gate knobs; defaults come from `ETL_CONFIG.backtest` (priors pending
 *  owner confirmation, see docs/DECISIONS.md). */
export interface BacktestGateOptions {
  /** Bootstrap resamples per resampling unit (D-023 `bootstrapResamples`). */
  readonly resamples?: number;
  /** Two-sided confidence level for the interval, e.g. 0.95. */
  readonly confidenceLevel?: number;
  /** Minimum required mean log-loss improvement (baseline minus engine). */
  readonly logLossTolerance?: number;
  /** Minimum distinct evaluated holdout matches before the gate can pass;
   *  below it the bootstrap has no independent-match evidence. */
  readonly minHoldoutMatches?: number;
}

export interface BacktestOptions {
  /** Roles to evaluate; defaults to every role (D-097 scope is
   *  SUPPORT/TOP/JUNGLE). */
  readonly roles?: readonly Role[];
  readonly gate?: BacktestGateOptions;
  /** Skip the paired-bootstrap gate entirely (grid searches that only read
   *  the point metrics, e.g. `tune-priors`). */
  readonly skipGate?: boolean;
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

export interface BacktestGateInterval {
  /** Observed mean of (baseline log-loss − engine log-loss); positive = engine better. */
  meanDelta: number;
  ciLower: number;
  ciUpper: number;
}

/** D-023 paired-bootstrap gate on holdout log-loss vs the champion-baseline
 *  model. Both resampling units are always reported; `passed` uses the
 *  configured gate unit (`match`, the D-023 default). */
export interface BacktestGate {
  metric: 'logLoss';
  comparison: 'engine-vs-championBaseline';
  resamples: number;
  confidenceLevel: number;
  logLossTolerance: number;
  /** Distinct evaluated holdout matches the gate requires before it can pass. */
  minHoldoutMatches: number;
  gateUnit: 'match';
  units: {
    match: BacktestGateInterval;
    player: BacktestGateInterval;
  };
  passed: boolean;
  /** The numeric thresholds are priors pending owner confirmation. */
  thresholdsPendingOwnerConfirmation: true;
}

export interface BacktestReport {
  holdoutPatch: string | null;
  trainingPatches: string[];
  holdoutGames: number;
  trainingGames: number;
  /** Roles this report evaluated (D-097 scope: SUPPORT, TOP, JUNGLE). */
  roles: Role[];
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
  gate: BacktestGate | null;
  /** D-128 matchup experiment result; null when the report is insufficient
   *  or the command did not run the experiment. */
  matchup: MatchupExperiment | null;
  insufficientData: boolean;
  validationStatus: 'unvalidated' | 'validated';
  message: string;
}

export type MatchupShrinkageK = number | 'off';

export interface MatchupCandidateResult {
  shrinkageK: MatchupShrinkageK;
  /** Validation-patch log-loss; null when the patch had no scored points. */
  logLoss: number | null;
}

/**
 * D-128 matchup experiment: `matchupShrinkK` candidates are selected on the
 * last training patch only (never the holdout), then evaluated once on the
 * holdout through the paired-bootstrap gate. `enabled` is true only when
 * the selected variant beats the champion baseline significantly.
 */
export interface MatchupExperiment {
  enabled: boolean;
  variant: 'off' | 'full' | 'shrunk';
  /** Selected `matchupShrinkK`; null when variant is 'off'. */
  shrinkageK: number | null;
  /** Last training patch used for k selection (train-only validation). */
  validationPatch: string | null;
  /** Roles pooled into the k selection and the holdout gate — the report's
   *  scored-covered roles, so pooled coverage matches top-level `roles`. */
  roles: Role[];
  candidates: MatchupCandidateResult[];
  /** Holdout gate of the selected variant; null when variant is 'off'. */
  gate: BacktestGate | null;
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

/** Deterministic PRNG (mulberry32): the backtest must be reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed seed for every bootstrap run so reports are byte-reproducible. */
const BOOTSTRAP_SEED = 0x9e3779b9;

/**
 * Percentile bootstrap CI of the mean of `units` (each unit is a group of
 * paired per-observation differences, resampled with replacement). Returns
 * the observed mean plus the two-sided `confidenceLevel` interval.
 */
function bootstrapInterval(
  units: readonly (readonly number[])[],
  resamples: number,
  confidenceLevel: number,
  seed: number,
): BacktestGateInterval {
  const observed: number[] = [];
  for (const unit of units) observed.push(...unit);
  const meanDelta =
    observed.length === 0 ? 0 : observed.reduce((a, b) => a + b, 0) / observed.length;
  if (units.length === 0 || resamples <= 0) {
    return { meanDelta, ciLower: meanDelta, ciUpper: meanDelta };
  }

  const rand = mulberry32(seed);
  const means: number[] = new Array<number>(resamples);
  for (let r = 0; r < resamples; r += 1) {
    let total = 0;
    let count = 0;
    for (let u = 0; u < units.length; u += 1) {
      const unit = units[Math.floor(rand() * units.length)];
      if (unit === undefined) continue;
      for (const d of unit) {
        total += d;
        count += 1;
      }
    }
    means[r] = count === 0 ? 0 : total / count;
  }
  means.sort((a, b) => a - b);
  const alpha = 1 - confidenceLevel;
  const lower = means[Math.floor((alpha / 2) * resamples)];
  const upper = means[Math.min(resamples - 1, Math.floor((1 - alpha / 2) * resamples))];
  return {
    meanDelta,
    ciLower: lower ?? meanDelta,
    ciUpper: upper ?? meanDelta,
  };
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
  matchId: string;
  /** Player identifier for the player bootstrap unit; never serialized. */
  playerId: string;
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
    matchId: row.matchId,
    playerId: row.playerId,
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
    'holdoutPatch' | 'trainingPatches' | 'holdoutGames' | 'trainingGames' | 'roles'
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
    gate: null,
    matchup: null,
    insufficientData: true,
    validationStatus: 'unvalidated',
    message,
  };
}

function insufficientWithFallbackCounts(
  partial: Pick<
    BacktestReport,
    'holdoutPatch' | 'trainingPatches' | 'holdoutGames' | 'trainingGames' | 'roles'
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

/** Evaluate every player of the given matches whose role is in `roleSet`. */
function collectPoints(
  matches: Iterable<readonly DraftRow[]>,
  engine: BacktestEngineData,
  roleSet: ReadonlySet<Role>,
): PlayerPoint[] {
  const points: PlayerPoint[] = [];
  for (const matchRows of matches) {
    for (const row of matchRows) {
      if (!roleSet.has(row.role)) continue;
      const point = evaluatePlayer(row, matchRows, engine);
      if (point !== null) points.push(point);
    }
  }
  return points;
}

interface PointSummary {
  predictions: number;
  unscored: number;
  logLoss: number;
  brier: number;
  baselineLogLoss: number;
  baselineBrier: number;
  perRole: Record<Role, RoleMetrics>;
  calibration: CalibrationBin[];
}

/** Mean metrics over scored points plus the per-role breakdown. */
function summarizePoints(points: readonly PlayerPoint[]): PointSummary {
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
  return {
    predictions: n,
    unscored: points.filter((p) => !p.scored).length,
    logLoss: logLoss / n,
    brier: brier / n,
    baselineLogLoss: baselineLogLoss / n,
    baselineBrier: baselineBrier / n,
    perRole,
    calibration: calibrationBins(points.map(({ pred, actual }) => ({ pred, actual }))),
  };
}

/** D-023 paired bootstrap on per-point (baseline − engine) log-loss diffs. */
function computeGate(
  points: readonly PlayerPoint[],
  gateOptions?: BacktestGateOptions,
): BacktestGate {
  const gateCfg = ETL_CONFIG.backtest;
  const resamples = gateOptions?.resamples ?? gateCfg.bootstrapResamples;
  const confidenceLevel = gateOptions?.confidenceLevel ?? gateCfg.confidenceLevel;
  const logLossTolerance = gateOptions?.logLossTolerance ?? gateCfg.logLossTolerance;
  const minHoldoutMatches = gateOptions?.minHoldoutMatches ?? gateCfg.minHoldoutMatches;
  const diffsByMatch = new Map<string, number[]>();
  const diffsByPlayer = new Map<string, number[]>();
  for (const point of points) {
    const diff =
      logLossBinary(point.baseline, point.actual) - logLossBinary(point.pred, point.actual);
    const list = diffsByMatch.get(point.matchId) ?? [];
    list.push(diff);
    diffsByMatch.set(point.matchId, list);
    const playerList = diffsByPlayer.get(point.playerId) ?? [];
    playerList.push(diff);
    diffsByPlayer.set(point.playerId, playerList);
  }
  const matchUnits = [...diffsByMatch.values()];
  // D-023 player unit: every appearance of the same player resamples together.
  const playerUnits = [...diffsByPlayer.values()];
  const matchInterval = bootstrapInterval(matchUnits, resamples, confidenceLevel, BOOTSTRAP_SEED);
  const playerInterval = bootstrapInterval(playerUnits, resamples, confidenceLevel, BOOTSTRAP_SEED);
  // A handful of matches cannot evidence an improvement: resampling them only
  // reuses the same matches, so the gate stays closed below the floor.
  const passed = matchUnits.length >= minHoldoutMatches && matchInterval.ciLower > logLossTolerance;
  return {
    metric: 'logLoss',
    comparison: 'engine-vs-championBaseline',
    resamples,
    confidenceLevel,
    logLossTolerance,
    minHoldoutMatches,
    gateUnit: 'match',
    units: { match: matchInterval, player: playerInterval },
    passed,
    thresholdsPendingOwnerConfirmation: true,
  };
}

export interface PatchEvaluation {
  predictions: number;
  unscored: number;
  logLoss: number | null;
  baselineLogLoss: number | null;
  brier: number | null;
  baselineBrier: number | null;
  gate: BacktestGate | null;
}

/**
 * Evaluate one patch's matches through the engine with the given role set —
 * the same scoring path as the holdout report, usable for train-only
 * validation (D-128 k selection) and single-shot holdout variant checks.
 */
export function evaluatePatch(
  rows: readonly DraftRow[],
  engine: BacktestEngineData,
  roles: readonly Role[],
  patch: string,
  gateOptions?: BacktestGateOptions,
): PatchEvaluation {
  const roleSet = new Set<Role>(ALL_ROLES.filter((role) => roles.includes(role)));
  const matches = [...groupByMatch(rows.filter((r) => r.patch === patch)).values()];
  const points = collectPoints(matches, engine, roleSet);
  if (points.length === 0) {
    return {
      predictions: 0,
      unscored: 0,
      logLoss: null,
      baselineLogLoss: null,
      brier: null,
      baselineBrier: null,
      gate: null,
    };
  }
  const summary = summarizePoints(points);
  return {
    predictions: summary.predictions,
    unscored: summary.unscored,
    logLoss: summary.logLoss,
    baselineLogLoss: summary.baselineLogLoss,
    brier: summary.brier,
    baselineBrier: summary.baselineBrier,
    gate: computeGate(points, gateOptions),
  };
}

export function runBacktestDraft(
  rows: DraftRow[],
  engine: BacktestEngineData,
  options: BacktestOptions = {},
): BacktestReport {
  const { holdoutPatch, trainingPatches } = draftPatchSplit(rows);
  const holdoutRows = rows.filter((r) => r.patch === holdoutPatch);
  const trainingRows = rows.filter((r) => trainingPatches.includes(r.patch));
  const holdoutMatches = groupByMatch(holdoutRows);
  const trainingMatches = groupByMatch(trainingRows);
  const requestedRoles = options.roles ?? ALL_ROLES;
  const roles = ALL_ROLES.filter((role) => requestedRoles.includes(role));
  const roleSet = new Set<Role>(roles);
  const counts = {
    holdoutPatch,
    trainingPatches,
    holdoutGames: holdoutMatches.size,
    trainingGames: trainingMatches.size,
    roles,
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

  const points = collectPoints(holdoutMatches.values(), engine, roleSet);

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

  const summary = summarizePoints(points);
  const gate = options.skipGate ? null : computeGate(points, options.gate);
  const n = points.length;

  return {
    holdoutPatch,
    trainingPatches,
    holdoutGames: holdoutMatches.size,
    trainingGames: trainingMatches.size,
    // Only roles with engine-scored holdout picks count as covered: a role
    // that only received baseline fallbacks says nothing about its matchups.
    roles: roles.filter((role) => points.some((p) => p.scored && p.role === role)),
    predictions: n,
    unscored: summary.unscored,
    logLoss: summary.logLoss,
    brier: summary.brier,
    baselineLogLoss: summary.baselineLogLoss,
    baselineBrier: summary.baselineBrier,
    calibration: summary.calibration,
    perRole: summary.perRole,
    gate,
    matchup: null,
    insufficientData: false,
    validationStatus: gate !== null && gate.passed ? 'validated' : 'unvalidated',
    message:
      gate === null
        ? 'Backtest complete (deployed engine, full-draft holdout evaluation). The paired-bootstrap gate was skipped; point metrics only. Masked drafts, rolling validation and layer ablation are not implemented.'
        : gate.passed
          ? `Backtest complete (deployed engine, full-draft holdout evaluation). The D-023 paired-bootstrap gate passed: match-unit ${gate.confidenceLevel} CI lower bound ${gate.units.match.ciLower.toFixed(4)} > log-loss tolerance ${gate.logLossTolerance}. Masked drafts, rolling validation and layer ablation are not implemented.`
          : `Backtest complete (deployed engine, full-draft holdout evaluation). validationStatus stays "unvalidated": the D-023 paired-bootstrap gate failed (match-unit ${gate.confidenceLevel} CI lower bound ${gate.units.match.ciLower.toFixed(4)} <= log-loss tolerance ${gate.logLossTolerance}, or fewer than ${gate.minHoldoutMatches} evaluated holdout matches). Masked drafts, rolling validation and layer ablation are not implemented.`,
  };
}
