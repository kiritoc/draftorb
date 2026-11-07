/**
 * @draftorb/engine — Profile runes and summoner spells (T-097, D-073/D-075,
 * SPECS §18.5).
 *
 * Pure, deterministic. Aggregates the configured profile's own games on a
 * champion into "Profile's best" rune pages and summoner-spell pairs using
 * the same recency weighting, shrinkage and fallback-level machinery as
 * `personalize()` (D-073). Fewer than `minSetupGames` effective games on a
 * setup yields an insufficient-data entry with `nEff`, never a number
 * (D-075). Engine output only — `score(c)` and existing results untouched.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import type { ProfileExport, ProfileGame, RecommendData } from '@draftorb/shared';

import {
  DEFAULT_PERSONALIZE_CONFIG,
  type FallbackLevel,
  type PersonalizeConfig,
  type PersonalizeContext,
} from './personalize.js';

const DAY_MS = 86_400_000;

/** Minimum effective games on a champion+setup before a rate is shown (D-075). */
export const DEFAULT_MIN_SETUP_GAMES = 5;
/** Number of rune pages / spell pairs returned (mirrors `topPages`). */
export const DEFAULT_SETUP_PICKS = 3;

export interface ProfileRunePick {
  readonly keystoneId: number;
  readonly primaryStyleId: number;
  readonly subStyleId: number;
  readonly perkIds: readonly number[];
  readonly statShardIds: readonly number[];
  /** Shrunk profile win rate (fraction); null when insufficient. */
  readonly winRate: number | null;
  /** Effective sample size at the matched fallback level. */
  readonly nEff: number;
  /** Raw game count behind the estimate. */
  readonly games: number;
  /** Fallback level that supplied the estimate; null when insufficient. */
  readonly fallbackLevel: FallbackLevel | null;
  readonly insufficientData: boolean;
}

export interface ProfileSpellPick {
  /** Normalized unordered pair `[minId, maxId]` of summoner spell ids. */
  readonly spells: readonly [number, number];
  readonly winRate: number | null;
  readonly nEff: number;
  readonly games: number;
  readonly fallbackLevel: FallbackLevel | null;
  readonly insufficientData: boolean;
}

interface WeightedProfileGame {
  readonly game: ProfileGame;
  readonly weight: number;
  readonly enemySignature: ReadonlySet<string>;
}

interface LevelPredicate {
  (game: ProfileGame, enemySignature: ReadonlySet<string>): boolean;
}

/** Same L1..L5 matchup-context predicates as `personalize()` (D-073). */
function levelPredicate(level: FallbackLevel, context: PersonalizeContext): LevelPredicate {
  switch (level) {
    case 1:
      return (game) =>
        context.allyAdcId !== null &&
        context.enemySupportId !== null &&
        game.allyAdcId === context.allyAdcId &&
        game.enemySupportId === context.enemySupportId;
    case 2:
      return (game) =>
        context.enemySupportId !== null && game.enemySupportId === context.enemySupportId;
    case 3:
      return (game, enemySignature) => {
        if (context.enemySignature.size === 0) return false;
        for (const pair of context.enemySignature) {
          if (!enemySignature.has(pair)) return false;
        }
        return true;
      };
    case 4:
    case 5:
      return () => true;
    default:
      return () => false;
  }
}

interface SetupStats {
  readonly nEff: number;
  readonly winsW: number;
  readonly gamesW: number;
  readonly rawGames: number;
}

function aggregateSetup(
  games: readonly WeightedProfileGame[],
  championId: number,
  setupKey: (game: ProfileGame) => string | null,
  key: string,
  context: PersonalizeContext,
  minGames: number,
): { stats: SetupStats | null; level: FallbackLevel | null; bestNEff: number } {
  let bestNEff = 0;
  for (let level = 1; level <= 5; level += 1) {
    const predicate = levelPredicate(level as FallbackLevel, context);
    let sumW = 0;
    let sumW2 = 0;
    let winsW = 0;
    let rawGames = 0;
    for (const weighted of games) {
      const game = weighted.game;
      if (game.championId !== championId || game.role !== 'SUPPORT') continue;
      if (setupKey(game) !== key) continue;
      if (!predicate(game, weighted.enemySignature)) continue;
      sumW += weighted.weight;
      sumW2 += weighted.weight * weighted.weight;
      if (game.win) winsW += weighted.weight;
      rawGames += 1;
    }
    const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
    bestNEff = Math.max(bestNEff, nEff);
    if (nEff >= minGames) {
      return {
        stats: { nEff, winsW, gamesW: sumW, rawGames },
        level: level as FallbackLevel,
        bestNEff,
      };
    }
  }
  return { stats: null, level: null, bestNEff };
}

function buildWeightedGames(
  profile: ProfileExport,
  data: RecommendData,
  nowMs: number,
  halfLifeDays: number,
): WeightedProfileGame[] {
  const nowDays = nowMs / DAY_MS;
  const signatureCache = new Map<number, string>();
  const tags = data.tags;
  const weighted: WeightedProfileGame[] = [];
  for (const game of profile.games) {
    if (game.role !== 'SUPPORT') continue;
    const ageDays = Math.max(0, nowDays - game.createdAtDay);
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
    weighted.push({
      game,
      weight: Math.pow(0.5, ageDays / halfLifeDays),
      enemySignature: signature,
    });
  }
  return weighted;
}

/** Champion-level base WR (all in-scope games on the champion) for shrinkage. */
function championBaseWinRate(games: readonly WeightedProfileGame[], championId: number): number {
  let winsW = 0;
  let gamesW = 0;
  for (const weighted of games) {
    if (weighted.game.championId !== championId) continue;
    gamesW += weighted.weight;
    if (weighted.game.win) winsW += weighted.weight;
  }
  return gamesW > 0 ? winsW / gamesW : 0.5;
}

function runePageKey(runes: NonNullable<ProfileGame['runes']>): string {
  return `${runes.keystoneId}:${runes.primaryStyleId}:${runes.subStyleId}`;
}

function spellPairKey(spells: readonly [number, number]): string {
  return `${Math.min(spells[0], spells[1])}:${Math.max(spells[0], spells[1])}`;
}

/**
 * "Profile's best" rune pages for `championId` (SPECS §18.5): the profile's
 * own rune pages ranked by shrunk win rate under the current draft context,
 * with the same fallback/shrinkage rules as the champion list.
 */
export function recommendProfileRunes(
  profile: ProfileExport,
  championId: number,
  context: PersonalizeContext,
  data: RecommendData,
  nowMs: number,
  options: {
    config?: PersonalizeConfig;
    minSetupGames?: number;
    topPicks?: number;
  } = {},
): ProfileRunePick[] {
  const config = options.config ?? DEFAULT_PERSONALIZE_CONFIG;
  const minGames = options.minSetupGames ?? DEFAULT_MIN_SETUP_GAMES;
  const topPicks = options.topPicks ?? DEFAULT_SETUP_PICKS;
  const games = buildWeightedGames(profile, data, nowMs, config.halfLifeDays);
  const base = championBaseWinRate(games, championId);

  // Group the champion's rune-carrying games by page identity.
  const pages = new Map<string, { runes: NonNullable<ProfileGame['runes']>; games: number }>();
  for (const weighted of games) {
    const game = weighted.game;
    if (game.championId !== championId || game.runes === null) continue;
    const key = runePageKey(game.runes);
    const existing = pages.get(key);
    if (existing === undefined) {
      pages.set(key, { runes: game.runes, games: 1 });
    } else {
      existing.games += 1;
    }
  }

  const picks: ProfileRunePick[] = [];
  for (const [key, page] of pages) {
    const { stats, level, bestNEff } = aggregateSetup(
      games,
      championId,
      (game) => (game.runes === null ? null : runePageKey(game.runes)),
      key,
      context,
      minGames,
    );
    if (stats === null) {
      picks.push({
        keystoneId: page.runes.keystoneId,
        primaryStyleId: page.runes.primaryStyleId,
        subStyleId: page.runes.subStyleId,
        perkIds: page.runes.perkIds,
        statShardIds: page.runes.statShardIds,
        winRate: null,
        nEff: bestNEff,
        games: page.games,
        fallbackLevel: null,
        insufficientData: true,
      });
      continue;
    }
    const p = (stats.winsW + config.kShrink * base) / (stats.gamesW + config.kShrink);
    picks.push({
      keystoneId: page.runes.keystoneId,
      primaryStyleId: page.runes.primaryStyleId,
      subStyleId: page.runes.subStyleId,
      perkIds: page.runes.perkIds,
      statShardIds: page.runes.statShardIds,
      winRate: p,
      nEff: stats.nEff,
      games: stats.rawGames,
      fallbackLevel: level,
      insufficientData: false,
    });
  }

  // Sufficient entries first by shrunk WR desc, then insufficient by nEff;
  // deterministic tie-break on the page key.
  picks.sort((a, b) => {
    if (a.insufficientData !== b.insufficientData) return a.insufficientData ? 1 : -1;
    const primary = b.insufficientData ? b.nEff - a.nEff : (b.winRate ?? 0) - (a.winRate ?? 0);
    if (primary !== 0) return primary;
    return `${a.keystoneId}:${a.primaryStyleId}:${a.subStyleId}`.localeCompare(
      `${b.keystoneId}:${b.primaryStyleId}:${b.subStyleId}`,
    );
  });
  return picks.slice(0, topPicks);
}

/**
 * "Profile's best" summoner-spell pairs for `championId` (SPECS §18.5):
 * same shrinkage/fallback/insufficient rules as the rune pages.
 */
export function recommendProfileSpells(
  profile: ProfileExport,
  championId: number,
  context: PersonalizeContext,
  data: RecommendData,
  nowMs: number,
  options: {
    config?: PersonalizeConfig;
    minSetupGames?: number;
    topPicks?: number;
  } = {},
): ProfileSpellPick[] {
  const config = options.config ?? DEFAULT_PERSONALIZE_CONFIG;
  const minGames = options.minSetupGames ?? DEFAULT_MIN_SETUP_GAMES;
  const topPicks = options.topPicks ?? DEFAULT_SETUP_PICKS;
  const games = buildWeightedGames(profile, data, nowMs, config.halfLifeDays);
  const base = championBaseWinRate(games, championId);

  const pairs = new Map<string, { spells: [number, number]; games: number }>();
  for (const weighted of games) {
    const game = weighted.game;
    if (game.championId !== championId) continue;
    const [s1, s2] = game.summonerSpells;
    const key = spellPairKey([s1, s2]);
    const existing = pairs.get(key);
    if (existing === undefined) {
      pairs.set(key, { spells: [Math.min(s1, s2), Math.max(s1, s2)], games: 1 });
    } else {
      existing.games += 1;
    }
  }

  const picks: ProfileSpellPick[] = [];
  for (const [key, pair] of pairs) {
    const { stats, level, bestNEff } = aggregateSetup(
      games,
      championId,
      (game) => spellPairKey(game.summonerSpells),
      key,
      context,
      minGames,
    );
    if (stats === null) {
      picks.push({
        spells: pair.spells,
        winRate: null,
        nEff: bestNEff,
        games: pair.games,
        fallbackLevel: null,
        insufficientData: true,
      });
      continue;
    }
    const p = (stats.winsW + config.kShrink * base) / (stats.gamesW + config.kShrink);
    picks.push({
      spells: pair.spells,
      winRate: p,
      nEff: stats.nEff,
      games: stats.rawGames,
      fallbackLevel: level,
      insufficientData: false,
    });
  }

  picks.sort((a, b) => {
    if (a.insufficientData !== b.insufficientData) return a.insufficientData ? 1 : -1;
    const primary = b.insufficientData ? b.nEff - a.nEff : (b.winRate ?? 0) - (a.winRate ?? 0);
    if (primary !== 0) return primary;
    return spellPairKey(a.spells).localeCompare(spellPairKey(b.spells));
  });
  return picks.slice(0, topPicks);
}
