/**
 * @draftorb/engine — Profile personalization (T-095, D-073/D-075, SPECS §18.2).
 *
 * Pure, deterministic. Blends the unchanged meta recommendations with the
 * configured profile's own recency-weighted win rate using the D-073
 * fallback hierarchy, Bayesian shrinkage and trust blend. `score(c)`,
 * reasons and ranks of the input list are never touched — the personalized
 * list is a separate output, like the pool lists (D-024/D-072 invariant).
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import {
  PERSONAL_RESULT_SCHEMA_VERSION,
  type DraftInput,
  type ProfileExport,
  type ProfileGame,
  type RankBucket,
  type Recommendation,
  type RecommendData,
} from '@draftorb/shared';

import { DEFAULT_CONFIG, rankToBucket } from './config.js';
import { baselineGate, baselinePrior } from './levels.js';
import { indexBaselines } from './recommend-indexes.js';
import { resolveKnownSlots } from './recommend-slots.js';
import { logit, sigmoid } from './weighting.js';

const DAY_MS = 86_400_000;

/** Tunable priors for the personalization arithmetic (D-073). */
export interface PersonalizeConfig {
  /** Recency half-life in days: w = 0.5^(age_days / halfLifeDays). */
  readonly halfLifeDays: number;
  /** Shrinkage prior strength (equivalent games) toward the profile global. */
  readonly kShrink: number;
  /** Minimum n_eff for a fallback level to be usable. */
  readonly minGames: number;
  /** Trust prior strength in the trust blend. */
  readonly kTrust: number;
  /** Per-level trust factors for L1..L5 (D-073). */
  readonly levelFactors: readonly number[];
  /**
   * n_eff gate for the champion's baseline row (D-080); defaults to the
   * recommendation layer's `minGames` so "fails the baseline gate" means
   * the same thing in both outputs.
   */
  readonly baselineMinGames?: number;
  /** Prior strength `k0` for the baseline win rate `w0` (D-080, SPECS §5). */
  readonly baselineK0?: number;
  /**
   * D-089 (PROPOSED): 'rankNorm' keeps the legacy D-073 blend of the
   * rank-position metaNorm with the profile win rate; 'logit' blends
   * `logit(metaScore)` and `logit(p)` in log-odds space so both terms share
   * probability units. Default 'rankNorm' until validated.
   */
  readonly blendMode?: 'rankNorm' | 'logit';
}

export const DEFAULT_PERSONALIZE_CONFIG: PersonalizeConfig = Object.freeze({
  halfLifeDays: 60,
  kShrink: 15,
  minGames: 3,
  kTrust: 20,
  levelFactors: Object.freeze([1.0, 0.9, 0.8, 0.7, 0.6]),
  blendMode: 'rankNorm',
});

/** Log-odds clamp for the D-089 blend (same scale as the engine `eps`). */
const BLEND_EPS = 1e-4;

/** Draft-side context the fallback levels match against (SPECS §18.2). */
export interface PersonalizeContext {
  /** Resolved ally ADC champion id; null when the draft does not reveal it. */
  readonly allyAdcId: number | null;
  /** Resolved enemy support champion id; null when unknown. */
  readonly enemySupportId: number | null;
  /** `damageType:archetype` signature of the known enemy champions (L3). */
  readonly enemySignature: ReadonlySet<string>;
  /** Rank bucket of `userRank` — the bucket baseline rows are read for (D-080). */
  readonly rankBucket: RankBucket;
}

/** Fallback levels, L1 (most specific) to L5 (champion overall). */
export type FallbackLevel = 1 | 2 | 3 | 4 | 5;

export interface PersonalizedEntry {
  readonly championId: number;
  /** 1-based position in the personalized list. */
  readonly rank: number;
  /** Rank in the unchanged overall list (tie-break + meta reference). */
  readonly overallRank: number;
  /** Unchanged meta `score(c)` of the input recommendation. */
  readonly metaScore: number;
  /** `(1 - trust) * metaNorm + trust * p`; metaNorm-only when insufficient. */
  readonly personalizedScore: number;
  /** Shrunk profile win rate (fraction); null when data is insufficient. */
  readonly profileWinRate: number | null;
  /** Effective sample size at the matched fallback level. */
  readonly nEff: number;
  /** Level that supplied the estimate; null when insufficient. */
  readonly fallbackLevel: FallbackLevel | null;
  /**
   * `round(100 * (p - w0))` percentage points vs the champion's baseline win
   * rate `w0` for `baselineBucket` (D-080); null when the baseline row has
   * no weighted evidence or fails the baseline gate.
   */
  readonly deltaVsBaselinePp: number | null;
  /** Baseline win rate `w0` (fraction) for `baselineBucket`; null when omitted. */
  readonly baselineWinRate: number | null;
  /** Rank bucket the baseline was read for; null when `baselineWinRate` is. */
  readonly baselineBucket: RankBucket | null;
  /** True when no fallback level reached `minGames` (D-075). */
  readonly insufficientData: boolean;
}

export interface PersonalizeResult {
  readonly schemaVersion: typeof PERSONAL_RESULT_SCHEMA_VERSION;
  readonly entries: readonly PersonalizedEntry[];
}

interface WeightedGame {
  readonly game: ProfileGame;
  readonly weight: number;
  /** `damageType:archetype` signature of the game's enemy team (L3). */
  readonly enemySignature: ReadonlySet<string>;
}

/**
 * Resolve the draft context used by the fallback levels: the ally ADC and
 * enemy support champion ids (via the same role inference as `recommend`)
 * and the enemy composition signature built from `champion-tags.json`.
 */
export function personalizeContext(input: DraftInput, data: RecommendData): PersonalizeContext {
  const allySlots = resolveKnownSlots(input.allies, 'ally', data.roleProb, [input.userRole]);
  const enemySlots = resolveKnownSlots(input.enemies, 'enemy', data.roleProb);
  const allyAdcId = allySlots.find((slot) => slot.role === 'ADC')?.championId ?? null;
  const enemySupportId = enemySlots.find((slot) => slot.role === 'SUPPORT')?.championId ?? null;
  const enemySignature = new Set<string>();
  for (const slot of input.enemies) {
    const tags = data.tags[String(slot.championId)];
    if (tags !== undefined) {
      enemySignature.add(`${tags.damageType}:${tags.archetype}`);
    }
  }
  return {
    allyAdcId,
    enemySupportId,
    enemySignature,
    rankBucket: rankToBucket(input.userRank),
  };
}

function gameSignature(
  game: ProfileGame,
  signatureCache: Map<number, string>,
  tags: RecommendData['tags'],
): ReadonlySet<string> {
  const signature = new Set<string>();
  for (const championId of game.enemyChampionIds) {
    let pair = signatureCache.get(championId);
    if (pair === undefined) {
      const championTags = tags[String(championId)];
      pair =
        championTags === undefined ? '' : `${championTags.damageType}:${championTags.archetype}`;
      signatureCache.set(championId, pair);
    }
    if (pair !== '') signature.add(pair);
  }
  return signature;
}

function matchesLevel(
  level: FallbackLevel,
  game: WeightedGame,
  championId: number,
  context: PersonalizeContext,
): boolean {
  const g = game.game;
  // Every level is champion-scoped (games the profile played ON the
  // candidate); levels widen the matchup context (D-073 interpretation,
  // see DECISIONS.md).
  if (g.championId !== championId || g.role !== 'SUPPORT') return false;
  switch (level) {
    case 1:
      return (
        context.allyAdcId !== null &&
        context.enemySupportId !== null &&
        g.allyAdcId === context.allyAdcId &&
        g.enemySupportId === context.enemySupportId
      );
    case 2:
      return context.enemySupportId !== null && g.enemySupportId === context.enemySupportId;
    case 3: {
      if (context.enemySignature.size === 0) return false;
      for (const pair of context.enemySignature) {
        if (!game.enemySignature.has(pair)) return false;
      }
      return true;
    }
    case 4:
      // Role overall: every in-scope (SUPPORT) game on the champion.
      return true;
    case 5:
      // Champion overall: identical to L4 while phase 1 stores/uses only
      // SUPPORT games (SPECS §18.1); kept distinct for later phases.
      return true;
    default:
      return false;
  }
}

interface LevelStats {
  readonly nEff: number;
  readonly winsW: number;
  readonly gamesW: number;
}

function levelStats(
  games: readonly WeightedGame[],
  championId: number,
  level: FallbackLevel,
  context: PersonalizeContext,
): LevelStats {
  let sumW = 0;
  let sumW2 = 0;
  let winsW = 0;
  for (const weighted of games) {
    if (!matchesLevel(level, weighted, championId, context)) continue;
    sumW += weighted.weight;
    sumW2 += weighted.weight * weighted.weight;
    if (weighted.game.win) winsW += weighted.weight;
  }
  const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  return { nEff, winsW, gamesW: sumW };
}

/**
 * Build the personalized champion list for the current draft.
 *
 * @param recommendations  The unchanged overall list (complete, ranked).
 * @param profile          The loaded profile export (games + mastery).
 * @param context          Draft context from `personalizeContext`.
 * @param data             RecommendData, needed for the L3 enemy signature
 *                         lookup inside profile games.
 * @param nowMs            Evaluation time in ms since epoch (pure — the
 *                         caller supplies the clock; D-073).
 * @param config           Tuning priors; defaults to DEFAULT_PERSONALIZE_CONFIG.
 */
export function personalize(
  recommendations: readonly Recommendation[],
  profile: ProfileExport,
  context: PersonalizeContext,
  data: RecommendData,
  nowMs: number,
  config: PersonalizeConfig = DEFAULT_PERSONALIZE_CONFIG,
): PersonalizeResult {
  const nowDays = nowMs / DAY_MS;
  const signatureCache = new Map<number, string>();
  const tags = data.tags;
  // D-080: baseline rows for the selected rank bucket, gated exactly like the
  // recommendation layer (n_eff >= baselineMinGames, gamesE > 0).
  const baselineIdx = indexBaselines(data.baselines, context.rankBucket);
  const baselineMinGames = config.baselineMinGames ?? DEFAULT_CONFIG.minGames;
  const baselineK0 = config.baselineK0 ?? DEFAULT_CONFIG.k0;

  // In-scope games: Support games only in phase 1 (SPECS §18.1).
  const weighted: WeightedGame[] = [];
  for (const game of profile.games) {
    if (game.role !== 'SUPPORT') continue;
    const ageDays = Math.max(0, nowDays - game.createdAtDay);
    weighted.push({
      game,
      weight: Math.pow(0.5, ageDays / config.halfLifeDays),
      enemySignature: gameSignature(game, signatureCache, tags),
    });
  }

  // p_profile: the profile's recency-weighted win rate over all in-scope
  // games; neutral 0.5 prior when the profile has no usable games.
  let profileWinsW = 0;
  let profileGamesW = 0;
  for (const w of weighted) {
    profileGamesW += w.weight;
    if (w.game.win) profileWinsW += w.weight;
  }
  const pProfile = profileGamesW > 0 ? profileWinsW / profileGamesW : 0.5;

  const total = recommendations.length;
  const entries: PersonalizedEntry[] = recommendations.map((rec) => {
    const metaNorm = total > 1 ? 1 - (rec.rank - 1) / (total - 1) : 1;

    // First fallback level with n_eff >= minGames wins (D-073).
    let matchedLevel: FallbackLevel | null = null;
    let matched: LevelStats | null = null;
    let bestNEff = 0;
    for (let level = 1; level <= 5; level += 1) {
      const fallbackLevel = level as FallbackLevel;
      const stats = levelStats(weighted, rec.championId, fallbackLevel, context);
      bestNEff = Math.max(bestNEff, stats.nEff);
      if (stats.nEff >= config.minGames) {
        matchedLevel = fallbackLevel;
        matched = stats;
        break;
      }
    }

    if (matched === null || matchedLevel === null) {
      // Insufficient data at every level: rank by meta only, report the
      // largest effective sample seen (never a fabricated percentage).
      return {
        championId: rec.championId,
        rank: 0,
        overallRank: rec.rank,
        metaScore: rec.score,
        personalizedScore: config.blendMode === 'logit' ? rec.score : metaNorm,
        profileWinRate: null,
        nEff: bestNEff,
        fallbackLevel: null,
        deltaVsBaselinePp: null,
        baselineWinRate: null,
        baselineBucket: null,
        insufficientData: true,
      };
    }

    const p = (matched.winsW + config.kShrink * pProfile) / (matched.gamesW + config.kShrink);
    const levelFactor = config.levelFactors[matchedLevel - 1] ?? 0.6;
    const trust = (matched.nEff * levelFactor) / (matched.nEff * levelFactor + config.kTrust);
    // D-073 legacy blend mixes ordinal metaNorm with a probability; D-089
    // blends both terms in log-odds space so the units match.
    const personalizedScore =
      config.blendMode === 'logit'
        ? sigmoid((1 - trust) * logit(rec.score, BLEND_EPS) + trust * logit(p, BLEND_EPS))
        : (1 - trust) * metaNorm + trust * p;

    // D-080 badge baseline: w0 is the champion's evidence-backed baseline win
    // rate for the selected bucket — the same p0 the insufficient-data
    // entries expose. Omitted (never a prior-only 50%) when the row is
    // missing, has no weighted evidence or fails the baseline gate.
    const baseRow = baselineIdx.get(rec.championId);
    const baselineWinRate =
      baseRow !== undefined && baseRow.gamesE > 0 && baselineGate(baseRow.nE, baselineMinGames)
        ? baselinePrior(baseRow.winsE, baseRow.gamesE, baselineK0)
        : null;
    return {
      championId: rec.championId,
      rank: 0,
      overallRank: rec.rank,
      metaScore: rec.score,
      personalizedScore,
      profileWinRate: p,
      nEff: matched.nEff,
      fallbackLevel: matchedLevel,
      deltaVsBaselinePp: baselineWinRate === null ? null : Math.round(100 * (p - baselineWinRate)),
      baselineWinRate,
      baselineBucket: baselineWinRate === null ? null : context.rankBucket,
      insufficientData: false,
    };
  });

  // Sort by personalizedScore desc; ties break by overall rank (D-073).
  const sorted = [...entries].sort(
    (a, b) =>
      (a.personalizedScore === b.personalizedScore
        ? 0
        : b.personalizedScore > a.personalizedScore
          ? 1
          : -1) || a.overallRank - b.overallRank,
  );
  return {
    schemaVersion: PERSONAL_RESULT_SCHEMA_VERSION,
    entries: sorted.map((entry, index) => ({ ...entry, rank: index + 1 })),
  };
}
