/**
 * @draftorb/etl — Draft backtest harness (D-023, T-027.a).
 *
 * Pure, deterministic backtest of the draft recommendation model. Splits
 * stored matches into a frozen temporal holdout (latest patch) and a training
 * window (earlier patches), trains a per-champion win-rate model, evaluates
 * log-loss / Brier / calibration on the holdout against a 0.5 baseline and a
 * baseline-only (overall win-rate) baseline, and reports per-role matchup
 * effects. No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import { comparePatches } from '../matches-store';
import { type Role, type RankBucket } from '@draftorb/shared';

export interface DraftRow {
  matchId: string;
  patch: string;
  teamId: number;
  championId: number;
  role: Role;
  win: number; // 1 when this participant's team won the match
  rankScore: number;
}

interface CalibrationBin {
  bin: number;
  meanPred: number;
  meanActual: number;
  count: number;
}

interface RoleEffect {
  effectSize: number | null;
  effectDetected: boolean;
}

export interface BacktestReport {
  holdoutPatch: string | null;
  trainingPatches: string[];
  holdoutGames: number;
  trainingGames: number;
  logLoss: number | null;
  brier: number | null;
  baselineLogLoss: number | null;
  baselineBrier: number | null;
  calibration: CalibrationBin[];
  perRole: Record<Role, RoleEffect>;
  insufficientData: boolean;
  message: string;
}

const MIN_TRAINING_GAMES = 5;
const EFFECT_THRESHOLD = 0.03;
const N_BINS = 10;

/** Map a numeric rank score to a rank bucket (approximate League scale). */
function scoreToBucket(rankScore: number): RankBucket {
  if (rankScore < 800) return 'IRON';
  if (rankScore < 1200) return 'BRONZE';
  if (rankScore < 1600) return 'SILVER';
  if (rankScore < 2000) return 'GOLD';
  if (rankScore < 2400) return 'PLATINUM';
  if (rankScore < 2800) return 'EMERALD';
  if (rankScore < 3200) return 'DIAMOND';
  return 'MASTER_PLUS';
}

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

/** Mean win rate of `championId` in `role` within `bucket` from trained rows. */
interface WinRateModel {
  wins: Map<string, number>;
  games: Map<string, number>;
  roleOverall: Map<Role, { wins: number; games: number }>;
}

function trainModel(rows: DraftRow[]): WinRateModel {
  const wins = new Map<string, number>();
  const games = new Map<string, number>();
  const roleOverall = new Map<Role, { wins: number; games: number }>();
  for (const row of rows) {
    const key = `${row.championId}|${row.role}|${scoreToBucket(row.rankScore)}`;
    wins.set(key, (wins.get(key) ?? 0) + row.win);
    games.set(key, (games.get(key) ?? 0) + 1);
    const ro = roleOverall.get(row.role) ?? { wins: 0, games: 0 };
    ro.wins += row.win;
    ro.games += 1;
    roleOverall.set(row.role, ro);
  }
  return { wins, games, roleOverall };
}

function winRate(model: WinRateModel, championId: number, role: Role, bucket: RankBucket): number {
  const key = `${championId}|${role}|${bucket}`;
  const g = model.games.get(key) ?? 0;
  if (g < MIN_TRAINING_GAMES) {
    const ro = model.roleOverall.get(role);
    const rg = ro?.games ?? 0;
    return rg > 0 ? ro!.wins / rg : 0.5;
  }
  return model.wins.get(key)! / g;
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

function matchBlueWin(rows: DraftRow[]): number {
  const blue = rows.find((r) => r.teamId === 100);
  return blue ? blue.win : 0;
}

/** Predict blue-team win probability from champion win rates. */
function predictBlueWinProb(model: WinRateModel, rows: DraftRow[], bucket: RankBucket): number {
  const blue = rows.filter((r) => r.teamId === 100);
  const red = rows.filter((r) => r.teamId === 200);
  if (blue.length === 0 || red.length === 0) return 0.5;
  const blueStrength =
    blue.reduce((sum, r) => sum + winRate(model, r.championId, r.role, bucket), 0) / blue.length;
  const redStrength =
    red.reduce((sum, r) => sum + winRate(model, r.championId, r.role, bucket), 0) / red.length;
  const total = blueStrength + redStrength;
  return total <= 0 ? 0.5 : blueStrength / total;
}

function calibrationBins(points: Array<{ pred: number; actual: number }>): CalibrationBin[] {
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

export function runBacktestDraft(rows: DraftRow[]): BacktestReport {
  const empty: RoleEffect = { effectSize: null, effectDetected: false };
  const perRole: Record<Role, RoleEffect> = {
    TOP: { ...empty },
    JUNGLE: { ...empty },
    MID: { ...empty },
    ADC: { ...empty },
    SUPPORT: { ...empty },
  };

  if (rows.length === 0) {
    return {
      holdoutPatch: null,
      trainingPatches: [],
      holdoutGames: 0,
      trainingGames: 0,
      logLoss: null,
      brier: null,
      baselineLogLoss: null,
      baselineBrier: null,
      calibration: [],
      perRole,
      insufficientData: true,
      message: 'No matches in the database; nothing to backtest.',
    };
  }

  const patches = [...new Set(rows.map((r) => r.patch))].sort(comparePatches);
  const holdoutPatch: string | null = patches[patches.length - 1] ?? null;
  const trainingPatches = patches.slice(0, -1);

  const holdoutRows = rows.filter((r) => r.patch === holdoutPatch);
  const trainingRows = rows.filter((r) => trainingPatches.includes(r.patch));

  if (trainingRows.length < MIN_TRAINING_GAMES || holdoutRows.length === 0) {
    return {
      holdoutPatch,
      trainingPatches,
      holdoutGames: holdoutRows.length,
      trainingGames: trainingRows.length,
      logLoss: null,
      brier: null,
      baselineLogLoss: null,
      baselineBrier: null,
      calibration: [],
      perRole,
      insufficientData: true,
      message:
        'Insufficient data for a backtest (need at least 5 training games and a non-empty holdout patch).',
    };
  }

  const model = trainModel(trainingRows);

  const bucketForMatch = (rows: DraftRow[]): RankBucket => {
    const scores = rows.map((r) => r.rankScore);
    const median = scores.length > 0 ? scores[Math.floor(scores.length / 2)]! : 0;
    return scoreToBucket(median);
  };

  const points: Array<{ pred: number; actual: number }> = [];
  for (const matchRows of groupByMatch(holdoutRows).values()) {
    const bucket = bucketForMatch(matchRows);
    const pred = predictBlueWinProb(model, matchRows, bucket);
    const actual = matchBlueWin(matchRows);
    points.push({ pred, actual });
  }

  const baselineRate =
    holdoutRows.reduce((sum, r) => sum + (r.teamId === 100 ? r.win : 0), 0) / holdoutRows.length;

  let logLoss = 0;
  let brier = 0;
  let baselineLogLoss = 0;
  let baselineBrier = 0;
  for (const { pred, actual } of points) {
    logLoss += logLossBinary(pred, actual);
    brier += brierBinary(pred, actual);
    baselineLogLoss += logLossBinary(baselineRate, actual);
    baselineBrier += brierBinary(baselineRate, actual);
  }
  const n = points.length;
  logLoss /= n;
  brier /= n;
  baselineLogLoss /= n;
  baselineBrier /= n;

  // Per-role matchup effect: strongest trained champion in the role; effect is
  // the difference in predicted blue win probability when that champion is on
  // blue vs on red across holdout matches where they play that role.
  for (const role of Object.keys(perRole) as Role[]) {
    let bestChampion: number | null = null;
    let bestRate = -1;
    for (const row of trainingRows) {
      if (row.role !== role) continue;
      const rate = winRate(model, row.championId, role, scoreToBucket(row.rankScore));
      if (rate > bestRate) {
        bestRate = rate;
        bestChampion = row.championId;
      }
    }
    if (bestChampion === null) continue;
    let sum = 0;
    let count = 0;
    for (const matchRows of groupByMatch(holdoutRows).values()) {
      const onBlue = matchRows.some(
        (r) => r.teamId === 100 && r.championId === bestChampion && r.role === role,
      );
      const onRed = matchRows.some(
        (r) => r.teamId === 200 && r.championId === bestChampion && r.role === role,
      );
      if (!onBlue && !onRed) continue;
      const bucket = bucketForMatch(matchRows);
      const pred = predictBlueWinProb(model, matchRows, bucket);
      sum += onBlue ? pred : 1 - pred;
      count += 1;
    }
    if (count === 0) continue;
    const effectSize = sum / count - 0.5;
    perRole[role] = { effectSize, effectDetected: Math.abs(effectSize) > EFFECT_THRESHOLD };
  }

  return {
    holdoutPatch,
    trainingPatches,
    holdoutGames: holdoutRows.length,
    trainingGames: trainingRows.length,
    logLoss,
    brier,
    baselineLogLoss,
    baselineBrier,
    calibration: calibrationBins(points.map(({ pred, actual }) => ({ pred, actual }))),
    perRole,
    insufficientData: false,
    message: 'Backtest complete.',
  };
}
