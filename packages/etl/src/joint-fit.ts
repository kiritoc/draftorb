/**
 * @draftorb/etl — Joint model fitting + validation (T-123, D-092 PROPOSED).
 *
 * Builds match-level training rows from `participants`+`matches`, fits the
 * engine's joint regularized model, evaluates it on masked drafts (each
 * stored participant is a masked pick: the other nine players are known),
 * and writes `data/public/joint-model.json`.
 *
 * Validation gates (D-023 extension):
 *  - rolling holdout: train on patches < eval patch, test on eval patch
 *  - paired bootstrap over eval matches for the top-1 accuracy delta vs
 *    the champion-prior baseline (seeded, deterministic)
 *  - layer ablation: refit without ally pairs / enemy pairs(+lane) / mains
 *  - planted-effect simulation lives in engine unit tests
 *
 * Logs carry counts only — never match ids or player ids.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type Database from 'better-sqlite3';

import {
  candidateLogits,
  contextFeatures,
  featuresLogit,
  fitJointModel,
  type JointLayer,
  type JointModelParams,
  type JointSlot,
  type JointTrainingRow,
} from '@draftorb/engine';
import type { ChampionId, Role } from '@draftorb/shared';

import { openDb } from './db';
import { defaultPublicDataDir, resolveDbPath } from './config/paths';

interface StoredPlayer {
  team_id: number;
  role: Role;
  champion_id: number;
  win: number;
}

interface MatchPlayers {
  match_id: string;
  patch: string;
  players: StoredPlayer[];
}

export interface JointFitOptions {
  db?: Database.Database;
  /** Patch held out for rolling validation; defaults to the newest patch. */
  evalPatch?: string;
  iterations?: number;
  l2?: number;
  /** Max matches used for fitting (deterministic: newest first). 0 = all. */
  limit?: number;
  /** Max participants evaluated per patch (0 = all). */
  evalLimit?: number;
  outPath?: string;
  onProgress?: (message: string) => void;
}

export interface JointValidationReport {
  evalPatch: string;
  trainMatches: number;
  evalMatches: number;
  evalParticipants: number;
  joint: { top1: number; top5: number; meanLogProb: number };
  hybrid: { top1: number; top5: number; meanLogProb: number };
  prior: { top1: number; top5: number; meanLogProb: number };
  bootstrap: {
    reps: number;
    jointTop1DeltaCi95: [number, number];
    hybridTop1DeltaCi95: [number, number];
  };
  winProb: Record<string, WinProbMetrics>;
  /** 95% CI of per-match mean log-loss delta: joint minus best trivial baseline. */
  winProbLogLossDeltaCi95: [number, number];
  ablation: Record<string, { top1: number; top5: number; meanLogProb: number }>;
}

export interface JointFitResult {
  params: JointModelParams;
  exportPath: string;
  validation: JointValidationReport;
  championCount: number;
}

function loadMatches(db: Database.Database): MatchPlayers[] {
  const rows = db
    .prepare(
      `SELECT m.match_id, m.patch, p.team_id, p.role, p.champion_id, p.win
       FROM matches m JOIN participants p ON p.match_id = m.match_id
       ORDER BY m.match_id, p.team_id, p.role`,
    )
    .all() as Array<{
    match_id: string;
    patch: string;
    team_id: number;
    role: Role;
    champion_id: number;
    win: number;
  }>;
  const byMatch = new Map<string, MatchPlayers>();
  for (const row of rows) {
    let entry = byMatch.get(row.match_id);
    if (entry === undefined) {
      entry = { match_id: row.match_id, patch: row.patch, players: [] };
      byMatch.set(row.match_id, entry);
    }
    entry.players.push({
      team_id: row.team_id,
      role: row.role,
      champion_id: row.champion_id,
      win: row.win,
    });
  }
  return [...byMatch.values()].filter((m) => m.players.length === 10);
}

/** Splits players into the two teams; returns null for malformed matches. */
function teamsOf(match: MatchPlayers): { ally: StoredPlayer[]; enemy: StoredPlayer[] } | null {
  const byTeam = new Map<number, StoredPlayer[]>();
  for (const player of match.players) {
    const list = byTeam.get(player.team_id) ?? [];
    list.push(player);
    byTeam.set(player.team_id, list);
  }
  if (byTeam.size !== 2) return null;
  const teams = [...byTeam.entries()].sort((a, b) => a[0] - b[0]);
  const ally = teams[0]![1];
  const enemy = teams[1]![1];
  if (ally.length !== 5 || enemy.length !== 5) return null;
  if (!ally.every((p) => p.win === ally[0]!.win) || !enemy.every((p) => p.win === enemy[0]!.win)) {
    return null;
  }
  if (ally[0]!.win === enemy[0]!.win) return null;
  return { ally, enemy };
}

function toSlots(players: readonly StoredPlayer[], side: 'ally' | 'enemy'): JointSlot[] {
  return players.map((p) => ({
    championId: p.champion_id as ChampionId,
    role: p.role,
    side,
  }));
}

function trainingRows(
  matches: readonly MatchPlayers[],
  dropLayers: ReadonlySet<JointLayer> = new Set(),
): JointTrainingRow[] {
  const rows: JointTrainingRow[] = [];
  for (const match of matches) {
    const teams = teamsOf(match);
    if (teams === null) continue;
    const features = contextFeatures(
      toSlots(teams.ally, 'ally'),
      toSlots(teams.enemy, 'enemy'),
    ).filter((f) => !dropLayers.has(f.layer));
    rows.push({ label: teams.ally[0]!.win === 1 ? 1 : 0, features });
  }
  return rows;
}

interface CandidateEval {
  top1: number;
  top5: number;
  meanLogProb: number;
  count: number;
}

function emptyEval(): CandidateEval {
  return { top1: 0, top5: 0, meanLogProb: 0, count: 0 };
}

function finalizeEval(evalAcc: CandidateEval): Omit<CandidateEval, 'count'> {
  const n = Math.max(1, evalAcc.count);
  return {
    top1: evalAcc.top1 / n,
    top5: evalAcc.top5 / n,
    meanLogProb: evalAcc.meanLogProb / n,
  };
}

/** Seeded PRNG (mulberry32) for the paired bootstrap — deterministic. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function latestExportPatch(publicDir: string): string {
  const pointer = JSON.parse(readFileSync(join(publicDir, 'latest.json'), 'utf8')) as {
    patch?: string;
  };
  if (typeof pointer.patch !== 'string') {
    throw new Error(`Invalid latest.json under ${publicDir}`);
  }
  return pointer.patch;
}

function loadRoleChampions(publicDir: string): Map<Role, ChampionId[]> {
  const patch = latestExportPatch(publicDir);
  const derived = JSON.parse(
    readFileSync(join(publicDir, patch, 'champions.derived.json'), 'utf8'),
  ) as Record<string, { roles?: string[] }>;
  const byRole = new Map<Role, ChampionId[]>();
  for (const role of ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const) {
    byRole.set(role, []);
  }
  for (const [id, entry] of Object.entries(derived)) {
    for (const role of entry.roles ?? []) {
      if ((byRole.get(role as Role) ?? []).includes(Number(id) as ChampionId) === false) {
        byRole.get(role as Role)?.push(Number(id) as ChampionId);
      }
    }
  }
  for (const list of byRole.values()) list.sort((a, b) => a - b);
  return byRole;
}

/** Pick counts per role:champion — the champion-prior baseline is pick frequency. */
function championPickCounts(matches: readonly MatchPlayers[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of matches) {
    for (const player of match.players) {
      const key = `${player.role}:${player.champion_id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Masked-draft evaluation: every stored participant is a hidden pick; the
 * other nine players form the known draft. Scores candidates by joint
 * logits (softmax) or champion priors (add-0.5 smoothing) and records
 * top-1/top-5 accuracy and mean log-probability of the actual pick.
 */
function evaluateMaskedDrafts(
  evalMatches: readonly MatchPlayers[],
  params: JointModelParams | null,
  candidatesByRole: ReadonlyMap<Role, readonly ChampionId[]>,
  pickCounts: ReadonlyMap<string, number>,
  evalLimit: number,
  priorBlend = 0,
): {
  joint: CandidateEval;
  prior: CandidateEval;
  hybrid: CandidateEval;
  perMatchTop1: number[];
  perMatchHybridTop1: number[];
} {
  const joint = emptyEval();
  const prior = emptyEval();
  const hybrid = emptyEval();
  const perMatchTop1: number[] = [];
  const perMatchHybridTop1: number[] = [];

  let evaluated = 0;
  for (const match of evalMatches) {
    const teams = teamsOf(match);
    if (teams === null) continue;
    let matchTop1 = 0;
    let matchHybridTop1 = 0;
    let matchPlayers = 0;
    for (const player of match.players) {
      if (evalLimit > 0 && evaluated >= evalLimit) break;
      const isAlly = teams.ally.includes(player);
      const own = isAlly ? teams.ally : teams.enemy;
      const foes = isAlly ? teams.enemy : teams.ally;
      const knownAlly = toSlots(
        own.filter((p) => p !== player),
        'ally',
      );
      const knownEnemy = toSlots(foes, 'enemy');
      const candidates = candidatesByRole.get(player.role) ?? [];
      if (candidates.length === 0) continue;

      // Joint model.
      if (params !== null) {
        const logits = candidateLogits(params, player.role, candidates, knownAlly, knownEnemy);
        const actual = logits.get(player.champion_id as ChampionId);
        if (actual !== undefined) {
          let max = -Infinity;
          for (const c of candidates) {
            const l = logits.get(c) ?? 0;
            if (l > max) max = l;
          }
          let sumExp = 0;
          for (const c of candidates) {
            sumExp += Math.exp((logits.get(c) ?? 0) - max);
          }
          const logProb = actual - max - Math.log(sumExp);
          joint.meanLogProb += logProb;
          joint.count += 1;
          const rank = [...candidates]
            .sort((a, b) => (logits.get(b) ?? 0) - (logits.get(a) ?? 0) || a - b)
            .indexOf(player.champion_id as ChampionId);
          if (rank === 0) {
            joint.top1 += 1;
            matchTop1 += 1;
          }
          if (rank < 5) joint.top5 += 1;

          // Hybrid: joint logit + pick-frequency offset (meta-strength term).
          if (priorBlend > 0) {
            const blended = new Map<ChampionId, number>();
            for (const c of candidates) {
              const pickN = pickCounts.get(`${player.role}:${c}`) ?? 0;
              blended.set(c, (logits.get(c) ?? 0) + priorBlend * Math.log(pickN + 0.5));
            }
            const bActual = blended.get(player.champion_id as ChampionId) ?? 0;
            let bMax = -Infinity;
            for (const c of candidates) {
              const v = blended.get(c) ?? 0;
              if (v > bMax) bMax = v;
            }
            let bSum = 0;
            for (const c of candidates) bSum += Math.exp((blended.get(c) ?? 0) - bMax);
            hybrid.meanLogProb += bActual - bMax - Math.log(bSum);
            hybrid.count += 1;
            const bRank = [...candidates]
              .sort((a, b) => (blended.get(b) ?? 0) - (blended.get(a) ?? 0) || a - b)
              .indexOf(player.champion_id as ChampionId);
            if (bRank === 0) {
              hybrid.top1 += 1;
              matchHybridTop1 += 1;
            }
            if (bRank < 5) hybrid.top5 += 1;
          }
        }
      }

      // Champion-prior baseline: pick frequency with add-0.5 smoothing.
      {
        const scored = candidates.map((c) => ({
          c,
          n: (pickCounts.get(`${player.role}:${c}`) ?? 0) + 0.5,
        }));
        const total = scored.reduce((sum, e) => sum + e.n, 0);
        const actual = scored.find((e) => e.c === player.champion_id);
        if (actual !== undefined) {
          prior.meanLogProb += Math.log(actual.n / total);
          prior.count += 1;
          const rank = [...scored]
            .sort((a, b) => b.n - a.n || a.c - b.c)
            .findIndex((e) => e.c === player.champion_id);
          if (rank === 0) prior.top1 += 1;
          if (rank >= 0 && rank < 5) prior.top5 += 1;
        }
      }

      evaluated += 1;
      matchPlayers += 1;
    }
    if (matchPlayers > 0) {
      perMatchTop1.push(matchTop1 / matchPlayers);
      perMatchHybridTop1.push(matchHybridTop1 / matchPlayers);
    }
    if (evalLimit > 0 && evaluated >= evalLimit) break;
  }

  return { joint, prior, hybrid, perMatchTop1, perMatchHybridTop1 };
}

/** Paired bootstrap CI of the mean per-match difference a - b (seeded). */
function bootstrapMeanDiff(a: readonly number[], b: readonly number[]): [number, number] {
  const rand = rng(0x5eed);
  const diffs: number[] = [];
  const n = Math.min(a.length, b.length);
  const reps = 200;
  for (let r = 0; r < reps; r += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const idx = Math.floor(rand() * n);
      sum += a[idx]! - b[idx]!;
    }
    diffs.push(sum / n);
  }
  diffs.sort((x, y) => x - y);
  return [diffs[Math.floor(reps * 0.025)]!, diffs[Math.floor(reps * 0.975)]!];
}

function bootstrapTop1Delta(
  jointPerMatch: readonly number[],
  priorPerMatch: readonly number[],
  reps = 200,
): [number, number] {
  const rand = rng(0x5eed);
  const diffs: number[] = [];
  const n = jointPerMatch.length;
  for (let r = 0; r < reps; r += 1) {
    let j = 0;
    let p = 0;
    for (let i = 0; i < n; i += 1) {
      const idx = Math.floor(rand() * n);
      j += jointPerMatch[idx]!;
      p += priorPerMatch[idx]!;
    }
    diffs.push(j / n - p / n);
  }
  diffs.sort((a, b) => a - b);
  return [diffs[Math.floor(reps * 0.025)]!, diffs[Math.floor(reps * 0.975)]!];
}

function topChampionsByRole(
  params: JointModelParams,
): Record<string, Array<{ championId: number; mainEffect: number }>> {
  const out: Record<string, Array<{ championId: number; mainEffect: number }>> = {};
  for (const role of ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']) {
    const entries: Array<{ championId: number; mainEffect: number }> = [];
    for (const [key, coef] of Object.entries(params.champMain)) {
      const [r, id] = key.split(':');
      if (r === role) entries.push({ championId: Number(id), mainEffect: coef });
    }
    entries.sort((a, b) => b.mainEffect - a.mainEffect || a.championId - b.championId);
    out[role] = entries.slice(0, 15);
  }
  return out;
}

export interface WinProbMetrics {
  logLoss: number;
  brier: number;
  accuracy: number;
  count: number;
}

/**
 * Win-probability evaluation on the same masked-draft protocol as
 * `etl backtest draft`: for every stored participant the full draft is
 * known (their own pick included), and the model predicts P(their team
 * wins). Baselines: constant train win rate and per-team-id win rate
 * (the "side" effect, since team_id is the match side).
 */
type WinProbModel = JointModelParams | 'constant' | 'side';

function evaluateWinProb(
  evalMatches: readonly MatchPlayers[],
  models: Record<string, WinProbModel>,
  trainWinRate: number,
  sideRates: ReadonlyMap<number, number>,
): { metrics: Record<string, WinProbMetrics>; perMatchLl: Record<string, number[]> } {
  const acc: Record<string, { ll: number; br: number; correct: number; n: number }> = {};
  const perMatchLl: Record<string, number[]> = {};
  const names = Object.keys(models);
  for (const name of names) {
    acc[name] = { ll: 0, br: 0, correct: 0, n: 0 };
    perMatchLl[name] = [];
  }

  for (const match of evalMatches) {
    const teams = teamsOf(match);
    if (teams === null) continue;
    const allyTeamId = teams.ally[0]!.team_id;

    // Cache per-perspective logits once per match (two sides only).
    const logitBySide = new Map<string, number>();
    for (const name of names) {
      const model = models[name]!;
      if (typeof model === 'string') continue;
      for (const sideTeamId of [allyTeamId, teams.enemy[0]!.team_id]) {
        const own = sideTeamId === allyTeamId ? teams.ally : teams.enemy;
        const other = own === teams.ally ? teams.enemy : teams.ally;
        logitBySide.set(
          `${name}:${sideTeamId}`,
          featuresLogit(model, contextFeatures(toSlots(own, 'ally'), toSlots(other, 'enemy'))),
        );
      }
    }

    for (const name of names) {
      const model = models[name]!;
      const a = acc[name]!;
      let matchLl = 0;
      for (const player of match.players) {
        let p: number;
        if (model === 'constant') {
          p = trainWinRate;
        } else if (model === 'side') {
          p = sideRates.get(player.team_id) ?? trainWinRate;
        } else {
          const logit = logitBySide.get(`${name}:${player.team_id}`)!;
          p = 1 / (1 + Math.exp(-logit));
        }
        const pc = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
        const ll = -(player.win * Math.log(pc) + (1 - player.win) * Math.log(1 - pc));
        matchLl += ll;
        a.ll += ll;
        a.br += (p - player.win) ** 2;
        if ((p >= 0.5 ? 1 : 0) === player.win) a.correct += 1;
        a.n += 1;
      }
      perMatchLl[name]!.push(matchLl / match.players.length);
    }
  }

  const metrics: Record<string, WinProbMetrics> = {};
  for (const name of names) {
    const a = acc[name]!;
    metrics[name] = {
      logLoss: a.ll / Math.max(1, a.n),
      brier: a.br / Math.max(1, a.n),
      accuracy: a.correct / Math.max(1, a.n),
      count: a.n,
    };
  }
  return { metrics, perMatchLl };
}

export async function runJointFit(options: JointFitOptions = {}): Promise<JointFitResult> {
  const log = options.onProgress ?? (() => {});
  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  try {
    log('Loading stored matches...');
    const allMatches = loadMatches(db);
    log(`${allMatches.length} complete matches loaded`);

    const patches = [...new Set(allMatches.map((m) => m.patch))].sort();
    const evalPatch = options.evalPatch ?? patches[patches.length - 1]!;
    const trainPool = allMatches.filter((m) => m.patch < evalPatch);
    const evalMatches = allMatches.filter((m) => m.patch === evalPatch);
    const limitedTrain =
      options.limit !== undefined && options.limit > 0
        ? trainPool.slice(-options.limit)
        : trainPool;
    log(
      `Rolling split: train patches < ${evalPatch} (${limitedTrain.length} matches), ` +
        `eval patch ${evalPatch} (${evalMatches.length} matches)`,
    );

    const publicDir = defaultPublicDataDir();
    const candidatesByRole = loadRoleChampions(publicDir);
    const fitConfig = {
      l2: options.l2 ?? 0.01,
      iterations: options.iterations ?? 80,
      learningRate: 0.2,
    };

    // Full model on the training pool (rolling), then refit on ALL matches
    // for the exported artifact.
    const trainRows = trainingRows(limitedTrain);
    log(`Fitting joint model on ${trainRows.length} match rows...`);
    const rollingParams = fitJointModel(trainRows, fitConfig);

    // Ablations on the same training rows.
    const ablation: JointValidationReport['ablation'] = {};
    const pickCounts = championPickCounts(limitedTrain);
    const evalAccFor = (params: JointModelParams | null) =>
      evaluateMaskedDrafts(
        evalMatches,
        params,
        candidatesByRole,
        pickCounts,
        options.evalLimit ?? 0,
        1,
      );
    const baselineEval = evaluateMaskedDrafts(
      evalMatches,
      null,
      candidatesByRole,
      pickCounts,
      options.evalLimit ?? 0,
      1,
    );

    const ablatedParams: Record<string, JointModelParams> = {};
    for (const [name, drop] of [
      ['noAllyPairs', new Set<JointLayer>(['allyPair'])],
      ['noEnemyPairs', new Set<JointLayer>(['enemyPair', 'laneVs'])],
      ['noChampMain', new Set<JointLayer>(['champMain'])],
    ] as const) {
      const rows = trainingRows(limitedTrain, drop);
      const ablated = fitJointModel(rows, fitConfig);
      ablatedParams[name] = ablated;
      const ev = evalAccFor(ablated);
      ablation[name] = {
        top1: finalizeEval(ev.joint).top1,
        top5: finalizeEval(ev.joint).top5,
        meanLogProb: finalizeEval(ev.joint).meanLogProb,
      };
      log(`Ablation ${name}: top1=${ablation[name]!.top1.toFixed(4)}`);
    }

    const jointEval = evalAccFor(rollingParams);
    const jointMetrics = finalizeEval(jointEval.joint);
    const hybridMetrics = finalizeEval(jointEval.hybrid);
    const priorMetrics = finalizeEval(baselineEval.prior);

    // Paired bootstrap needs per-match joint top1; rerun cheaply per match.
    // evaluateMaskedDrafts already returns per-match joint accuracy.
    // For the prior side we recompute per-match prior accuracy inline:
    const priorPerMatch: number[] = [];
    {
      // Recompute prior-only per-match accuracy with the same candidate sets.
      let idx = 0;
      for (const match of evalMatches) {
        const teams = teamsOf(match);
        if (teams === null) continue;
        let hits = 0;
        let count = 0;
        for (const player of match.players) {
          if (options.evalLimit !== undefined && options.evalLimit > 0 && idx >= options.evalLimit)
            break;
          const candidates = candidatesByRole.get(player.role) ?? [];
          const scored = candidates
            .map((c) => ({ c, n: (pickCounts.get(`${player.role}:${c}`) ?? 0) + 0.5 }))
            .sort((a, b) => b.n - a.n || a.c - b.c);
          if (scored[0]?.c === player.champion_id) hits += 1;
          count += 1;
          idx += 1;
        }
        if (count > 0) priorPerMatch.push(hits / count);
        if (options.evalLimit !== undefined && options.evalLimit > 0 && idx >= options.evalLimit)
          break;
      }
    }
    const ci = bootstrapTop1Delta(jointEval.perMatchTop1, priorPerMatch);
    const hybridCi = bootstrapTop1Delta(jointEval.perMatchHybridTop1, priorPerMatch);

    // Win-probability evaluation (the model's actual target): P(team win)
    // per masked participant on the same holdout, vs trivial baselines.
    let trainWins = 0;
    let trainPlayerCount = 0;
    const sideWins = new Map<number, { wins: number; games: number }>();
    for (const match of limitedTrain) {
      for (const player of match.players) {
        trainWins += player.win;
        trainPlayerCount += 1;
        const entry = sideWins.get(player.team_id) ?? { wins: 0, games: 0 };
        entry.wins += player.win;
        entry.games += 1;
        sideWins.set(player.team_id, entry);
      }
    }
    const trainWinRate = trainPlayerCount > 0 ? trainWins / trainPlayerCount : 0.5;
    const sideRates = new Map<number, number>();
    for (const [teamId, entry] of sideWins) {
      sideRates.set(teamId, entry.games > 0 ? entry.wins / entry.games : trainWinRate);
    }
    const winProbModels: Record<string, JointModelParams | 'constant' | 'side'> = {
      constant: 'constant',
      side: 'side',
      joint: rollingParams,
      noAllyPairs: ablatedParams['noAllyPairs'] ?? rollingParams,
      noEnemyPairs: ablatedParams['noEnemyPairs'] ?? rollingParams,
      noChampMain: ablatedParams['noChampMain'] ?? rollingParams,
    };
    const winProbEval = evaluateWinProb(evalMatches, winProbModels, trainWinRate, sideRates);
    const bestTrivial =
      winProbEval.metrics['constant']!.logLoss <= winProbEval.metrics['side']!.logLoss
        ? 'constant'
        : 'side';
    const llCi = bootstrapMeanDiff(
      winProbEval.perMatchLl['joint']!,
      winProbEval.perMatchLl[bestTrivial]!,
    );
    log(
      `Win-prob (${evalPatch}): joint logLoss=${winProbEval.metrics['joint']!.logLoss.toFixed(4)} ` +
        `brier=${winProbEval.metrics['joint']!.brier.toFixed(4)} | ` +
        `constant=${winProbEval.metrics['constant']!.logLoss.toFixed(4)} ` +
        `side=${winProbEval.metrics['side']!.logLoss.toFixed(4)} ` +
        `| ΔlogLoss vs ${bestTrivial} 95% CI [${llCi[0].toFixed(5)}, ${llCi[1].toFixed(5)}]`,
    );

    const validation: JointValidationReport = {
      evalPatch,
      trainMatches: limitedTrain.length,
      evalMatches: evalMatches.length,
      evalParticipants: jointEval.joint.count,
      joint: jointMetrics,
      hybrid: hybridMetrics,
      prior: priorMetrics,
      bootstrap: {
        reps: 200,
        jointTop1DeltaCi95: ci,
        hybridTop1DeltaCi95: hybridCi,
      },
      winProb: winProbEval.metrics,
      winProbLogLossDeltaCi95: llCi,
      ablation,
    };

    // Final artifact: fit on ALL matches (train + eval patch) for export.
    log('Fitting final model on all matches for export...');
    const allRows = trainingRows(allMatches);
    const params = fitJointModel(allRows, fitConfig);

    const outPath = options.outPath ?? join(publicDir, 'joint-model.json');
    mkdirSync(dirname(outPath), { recursive: true });
    const exportDoc = {
      schemaVersion: 1,
      modelVersion: 1,
      trainedAt: new Date().toISOString(),
      latestPatch: patches[patches.length - 1],
      fit: fitConfig,
      trainedMatches: allMatches.length,
      bias: params.bias,
      tables: {
        champMain: params.champMain,
        allyPair: params.allyPair,
        enemyPair: params.enemyPair,
        laneVs: params.laneVs,
      },
      topChampionsByRole: topChampionsByRole(params),
      validation,
      status: 'unvalidated',
    };
    writeFileSync(outPath, `${JSON.stringify(exportDoc, null, 1)}\n`);
    log(`Wrote ${outPath}`);
    log(
      `Validation (${evalPatch}): joint top1=${jointMetrics.top1.toFixed(4)} ` +
        `top5=${jointMetrics.top5.toFixed(4)} logProb=${jointMetrics.meanLogProb.toFixed(4)} | ` +
        `hybrid(+pickprior) top1=${hybridMetrics.top1.toFixed(4)} ` +
        `top5=${hybridMetrics.top5.toFixed(4)} logProb=${hybridMetrics.meanLogProb.toFixed(4)} | ` +
        `prior top1=${priorMetrics.top1.toFixed(4)} top5=${priorMetrics.top5.toFixed(4)} ` +
        `logProb=${priorMetrics.meanLogProb.toFixed(4)} | ` +
        `bootstrap Δtop1 95% CI joint [${ci[0].toFixed(4)}, ${ci[1].toFixed(4)}] ` +
        `hybrid [${hybridCi[0].toFixed(4)}, ${hybridCi[1].toFixed(4)}]`,
    );

    return { params, exportPath: outPath, validation, championCount: allRows.length };
  } finally {
    if (ownsDb) db.close();
  }
}
