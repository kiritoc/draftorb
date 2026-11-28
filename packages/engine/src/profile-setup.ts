/**
 * @draftorb/engine — Profile runes and summoner spells (T-097, D-073/D-075,
 * SPECS §18.5).
 *
 * Pure, deterministic. Aggregates the configured profile's own games on a
 * champion into "Profile's best" rune pages and summoner-spell pairs using
 * the same recency weighting, shrinkage and fallback-level machinery as
 * `personalize()` (D-073), with per-role L1/L2 matchup slots (BL-056,
 * SPECS §18.5). Fewer than `minSetupGames` effective games on a
 * setup yields an insufficient-data entry with `nEff`, never a number
 * (D-075). Engine output only — `score(c)` and existing results untouched.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import type {
  ChampionRoleProbabilities,
  ChampionTagsMap,
  ProfileExport,
  ProfileGame,
  Role,
  StarterBundleItem,
} from '@draftorb/shared';

import {
  DEFAULT_PERSONALIZE_CONFIG,
  type FallbackLevel,
  type PersonalizeConfig,
  type PersonalizeContext,
  personalizeScopeRole,
} from './personalize.js';
import { starterBundleItemsKey } from './starters.js';
import {
  matchupIdsMatch,
  resolveMatchupSpec,
  roleMatchupSpec,
  type MatchupIdLookup,
  type ResolvedMatchup,
} from './matchup-context.js';
import { inferRoles } from './roles.js';

const DAY_MS = 86_400_000;

/** Minimum effective games on a champion+setup before a rate is shown (D-075). */
export const DEFAULT_MIN_SETUP_GAMES = 5;
/** Number of rune pages / spell pairs returned (mirrors `topPages`). */
export const DEFAULT_SETUP_PICKS = 3;

/**
 * Minimal data the profile setup aggregators need: champion tags for the
 * L3 enemy signature. `RecommendData` satisfies this structurally, so the
 * rune-only setup path does not have to load the pair/lane tables (BL-030a).
 */
export interface ProfileSetupData {
  readonly tags: ChampionTagsMap;
  /**
   * championId -> { role: prob } — resolves the enemy roles of a profile
   * game's `enemyChampionIds` for the per-role matchup contexts (BL-056).
   * `RecommendData`/`RuneRecommendData` satisfy this structurally.
   */
  readonly roleProb: ChampionRoleProbabilities;
}

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

export interface ProfileStarterPick {
  /** The bundle items, sorted by itemId (`starterBundleKey` grouping). */
  readonly items: readonly StarterBundleItem[];
  readonly winRate: number | null;
  readonly nEff: number;
  readonly games: number;
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
  /**
   * The game's L1/L2 matchup champion ids resolved through the drafted
   * role's spec (BL-056); null when the role has no matchup spec.
   */
  readonly matchup: ResolvedMatchup | null;
}

/** Match context the L1..L3 predicates need (BL-056 per-role slots + L3 signature). */
interface SetupMatchContext {
  readonly enemySignature: ReadonlySet<string>;
  /** Draft-side L1/L2 requirements; null when the role has no spec. */
  readonly matchup: ResolvedMatchup | null;
}

interface LevelPredicate {
  (game: WeightedProfileGame, context: SetupMatchContext): boolean;
}

/**
 * L1..L3 matchup-context predicates. L1/L2 follow the drafted role's
 * `RoleMatchupSpec` (BL-056): SUPPORT keeps the original ally-ADC +
 * enemy-support pair, TOP matches enemy TOP (+ enemy JUNGLE at L1),
 * JUNGLE matches enemy JUNGLE (+ enemy MID at L1). An unknown context id
 * disables the level — the game pool then resolves at L3/L4/L5, never a
 * fabricated match (D-075/D-103).
 */
function levelPredicate(level: FallbackLevel, context: SetupMatchContext): LevelPredicate {
  switch (level) {
    case 1:
      return (game) =>
        context.matchup !== null &&
        game.matchup !== null &&
        matchupIdsMatch(context.matchup.l1, game.matchup.l1);
    case 2:
      return (game) =>
        context.matchup !== null &&
        game.matchup !== null &&
        matchupIdsMatch(context.matchup.l2, game.matchup.l2);
    case 3:
      return (game) => {
        if (context.enemySignature.size === 0) return false;
        for (const pair of context.enemySignature) {
          if (!game.enemySignature.has(pair)) return false;
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
  context: SetupMatchContext,
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
      // The pool is already scoped to the in-scope role (D-097); only the
      // champion and setup identity are checked here.
      if (game.championId !== championId) continue;
      if (setupKey(game) !== key) continue;
      if (!predicate(weighted, context)) continue;
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

/**
 * Champion lookup for one profile game: the stored matchup ids cover the
 * ally ADC and the enemy SUPPORT/ADC exactly; the remaining enemy roles
 * (TOP/JUNGLE/MID) come from `inferRoles` over `enemyChampionIds` with the
 * draft's role probabilities — the same inference the draft side applies
 * (BL-056). Ally roles other than ADC are never stored, so they resolve
 * null and simply cannot satisfy a spec slot.
 */
function profileGameMatchupLookup(
  game: ProfileGame,
  enemyRoleIds: Readonly<Partial<Record<Role, number>>>,
): MatchupIdLookup {
  return (side, slotRole) => {
    if (side === 'ally') {
      return slotRole === 'ADC' ? game.allyAdcId : null;
    }
    if (slotRole === 'SUPPORT') return game.enemySupportId;
    if (slotRole === 'ADC') return game.enemyAdcId;
    return enemyRoleIds[slotRole] ?? null;
  };
}

/**
 * Enemy team role -> champion id for one profile game. The stored
 * `enemySupportId`/`enemyAdcId` fields are exact match data and take
 * precedence; `enemyChampionIds` (roles not stored in the export) is
 * completed by `inferRoles` — fixed slots for the known ids, unfixed for
 * the rest. When inference is impossible (missing role probabilities,
 * inconsistent team size) only the stored ids are returned, so TOP/JUNGLE
 * contexts degrade to L3/L4/L5 rather than guessing (D-103).
 */
function inferGameEnemyRoleIds(
  game: ProfileGame,
  roleProb: ChampionRoleProbabilities,
  cache: Map<string, Partial<Record<Role, number>>>,
): Partial<Record<Role, number>> {
  const enemyIds = [...new Set(game.enemyChampionIds)].sort((a, b) => a - b);
  const cacheKey = `${game.enemySupportId ?? ''}:${game.enemyAdcId ?? ''}:${enemyIds.join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result: Partial<Record<Role, number>> = {};
  const slots: Array<{ championId: number; role?: Role }> = [];
  const knownIds = new Set<number>();
  if (game.enemySupportId !== null) {
    result.SUPPORT = game.enemySupportId;
    knownIds.add(game.enemySupportId);
    slots.push({ championId: game.enemySupportId, role: 'SUPPORT' });
  }
  if (game.enemyAdcId !== null) {
    result.ADC = game.enemyAdcId;
    knownIds.add(game.enemyAdcId);
    slots.push({ championId: game.enemyAdcId, role: 'ADC' });
  }
  for (const championId of enemyIds) {
    if (!knownIds.has(championId)) slots.push({ championId });
  }

  // inferRoles handles 1-5 slots; a larger or empty set means the export
  // is inconsistent — keep the stored ids only.
  if (slots.length > 0 && slots.length <= 5) {
    const assignment = inferRoles(slots, roleProb);
    if (assignment !== null) {
      for (const slot of assignment.slots) {
        result[slot.role] = slot.championId;
      }
    }
  }
  cache.set(cacheKey, result);
  return result;
}

function buildWeightedGames(
  profile: ProfileExport,
  data: ProfileSetupData,
  nowMs: number,
  halfLifeDays: number,
  role: Role,
): WeightedProfileGame[] {
  const nowDays = nowMs / DAY_MS;
  const signatureCache = new Map<number, string>();
  const enemyRoleCache = new Map<string, Partial<Record<Role, number>>>();
  const tags = data.tags;
  // Same role scope as `personalize()` (D-097, D-136): only games played in
  // the requested role, and only when that role is in scope
  // (SUPPORT/TOP/JUNGLE). ADC/MID or any out-of-scope role yields an empty
  // pool, so every pick reports insufficient data.
  const scopeRole = personalizeScopeRole(role);
  const spec = scopeRole === null ? null : roleMatchupSpec(scopeRole);
  const weighted: WeightedProfileGame[] = [];
  for (const game of profile.games) {
    if (scopeRole === null || game.role !== scopeRole) continue;
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
    const matchup =
      spec === null
        ? null
        : resolveMatchupSpec(
            spec,
            profileGameMatchupLookup(
              game,
              inferGameEnemyRoleIds(game, data.roleProb, enemyRoleCache),
            ),
          );
    weighted.push({
      game,
      weight: Math.pow(0.5, ageDays / halfLifeDays),
      enemySignature: signature,
      matchup,
    });
  }
  return weighted;
}

/** Champion-level base WR (in-scope games on the champion) for shrinkage. */
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

/**
 * Draft-side `(side, role) -> championId` lookup for the per-role matchup
 * specs (BL-056). Prefers the resolved `allyRoleIds`/`enemyRoleIds` maps
 * filled by `personalizeContext`; falls back to the legacy
 * `allyAdcId`/`enemySupportId` fields so hand-built contexts keep their
 * SUPPORT behavior. Ally roles other than ADC are never stored in profile
 * games, so they resolve null on the game side regardless.
 */
function draftMatchupLookup(context: PersonalizeContext): MatchupIdLookup {
  return (side, slotRole) => {
    if (side === 'ally') {
      if (slotRole === 'ADC') return context.allyRoleIds?.ADC ?? context.allyAdcId;
      return context.allyRoleIds?.[slotRole] ?? null;
    }
    if (slotRole === 'SUPPORT') {
      return context.enemyRoleIds?.SUPPORT ?? context.enemySupportId;
    }
    if (slotRole === 'ADC') return context.enemyRoleIds?.ADC ?? null;
    return context.enemyRoleIds?.[slotRole] ?? null;
  };
}

/** Resolve the draft context once per call into the L1..L3 match context. */
function setupMatchContext(context: PersonalizeContext, role: Role): SetupMatchContext {
  const scopeRole = personalizeScopeRole(role);
  const spec = scopeRole === null ? null : roleMatchupSpec(scopeRole);
  return {
    enemySignature: context.enemySignature,
    matchup: spec === null ? null : resolveMatchupSpec(spec, draftMatchupLookup(context)),
  };
}

function runePageKey(runes: NonNullable<ProfileGame['runes']>): string {
  return `${runes.keystoneId}:${runes.primaryStyleId}:${runes.subStyleId}`;
}

function spellPairKey(spells: readonly [number, number]): string {
  return `${Math.min(spells[0], spells[1])}:${Math.max(spells[0], spells[1])}`;
}

/**
 * "Profile's best" rune pages for `championId` in `role` (SPECS §18.5): the
 * profile's own rune pages ranked by shrunk win rate under the current draft
 * context, with the same fallback/shrinkage rules as the champion list.
 * Only in-scope games recorded in `role` count: SUPPORT/TOP/JUNGLE only,
 * an out-of-scope role yields no picks (D-097/D-136).
 */
export function recommendProfileRunes(
  profile: ProfileExport,
  championId: number,
  role: Role,
  context: PersonalizeContext,
  data: ProfileSetupData,
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
  const games = buildWeightedGames(profile, data, nowMs, config.halfLifeDays, role);
  const matchContext = setupMatchContext(context, role);
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
      matchContext,
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
 * "Profile's best" summoner-spell pairs for `championId` in `role`
 * (SPECS §18.5): same shrinkage/fallback/insufficient rules as the rune
 * pages. Only in-scope games recorded in `role` count (D-097/D-136).
 */
export function recommendProfileSpells(
  profile: ProfileExport,
  championId: number,
  role: Role,
  context: PersonalizeContext,
  data: ProfileSetupData,
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
  const games = buildWeightedGames(profile, data, nowMs, config.halfLifeDays, role);
  const matchContext = setupMatchContext(context, role);
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
      matchContext,
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

/**
 * Bundle identity of a profile game: the `starterBundleKey` "itemId:count"
 * form of its exported `starterItems` (schema v3, BL-059). Games without a
 * recorded bundle return null and count toward no bundle — the same
 * treatment `runes === null` gets in the rune/spell aggregators.
 */
function starterBundleGameKey(game: ProfileGame): string | null {
  const items = game.starterItems;
  if (items === undefined || items === null || items.length === 0) return null;
  return starterBundleItemsKey(items);
}

/**
 * "Profile's best" starter bundles for `championId` in `role` (SPECS
 * §18.5, BL-059): the profile's own net starter-window bundles (recorded
 * per game by `profile-sync`, D-086/D-139) ranked by shrunk win rate under
 * the current draft context, with the same fallback/shrinkage/insufficient
 * rules as the rune pages and spell pairs. Only in-scope games recorded in
 * `role` count (D-097/D-136); games synced before schema v3 carry no
 * `starterItems` and simply never match a bundle.
 */
export function recommendProfileStarters(
  profile: ProfileExport,
  championId: number,
  role: Role,
  context: PersonalizeContext,
  data: ProfileSetupData,
  nowMs: number,
  options: {
    config?: PersonalizeConfig;
    minSetupGames?: number;
    topPicks?: number;
  } = {},
): ProfileStarterPick[] {
  const config = options.config ?? DEFAULT_PERSONALIZE_CONFIG;
  const minGames = options.minSetupGames ?? DEFAULT_MIN_SETUP_GAMES;
  const topPicks = options.topPicks ?? DEFAULT_SETUP_PICKS;
  const games = buildWeightedGames(profile, data, nowMs, config.halfLifeDays, role);
  const matchContext = setupMatchContext(context, role);
  const base = championBaseWinRate(games, championId);

  const bundles = new Map<string, { items: readonly StarterBundleItem[]; games: number }>();
  for (const weighted of games) {
    const game = weighted.game;
    if (game.championId !== championId) continue;
    const items = game.starterItems;
    if (items === undefined || items === null || items.length === 0) continue;
    const key = starterBundleItemsKey(items);
    const existing = bundles.get(key);
    if (existing === undefined) {
      bundles.set(key, { items, games: 1 });
    } else {
      existing.games += 1;
    }
  }

  const picks: ProfileStarterPick[] = [];
  for (const [key, bundle] of bundles) {
    const { stats, level, bestNEff } = aggregateSetup(
      games,
      championId,
      starterBundleGameKey,
      key,
      matchContext,
      minGames,
    );
    if (stats === null) {
      picks.push({
        items: bundle.items,
        winRate: null,
        nEff: bestNEff,
        games: bundle.games,
        fallbackLevel: null,
        insufficientData: true,
      });
      continue;
    }
    const p = (stats.winsW + config.kShrink * base) / (stats.gamesW + config.kShrink);
    picks.push({
      items: bundle.items,
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
    return starterBundleItemsKey(a.items).localeCompare(starterBundleItemsKey(b.items));
  });
  return picks.slice(0, topPicks);
}

export interface ProfileChampionStat {
  /** Recency-weighted profile win rate on the champion+role; null with no games. */
  readonly winRate: number | null;
  /** Effective sample size `(sum w)^2 / sum w^2` over the same games. */
  readonly nEff: number;
  /** Raw game count on the champion+role. */
  readonly games: number;
  /** True when `nEff` is below the setup minimum (D-075). */
  readonly insufficientData: boolean;
}

/**
 * The profile's own champion win rate in `role` (D-103 broader statistic):
 * used by the setup result when no rune page reaches the evidence minimum,
 * so the screen can still show a labeled fallback instead of nothing.
 */
export function profileChampionWinRate(
  profile: ProfileExport,
  championId: number,
  role: Role,
  data: ProfileSetupData,
  nowMs: number,
  options: {
    config?: PersonalizeConfig;
    minSetupGames?: number;
  } = {},
): ProfileChampionStat {
  const config = options.config ?? DEFAULT_PERSONALIZE_CONFIG;
  const minGames = options.minSetupGames ?? DEFAULT_MIN_SETUP_GAMES;
  const games = buildWeightedGames(profile, data, nowMs, config.halfLifeDays, role);
  let sumW = 0;
  let sumW2 = 0;
  let winsW = 0;
  let rawGames = 0;
  for (const weighted of games) {
    if (weighted.game.championId !== championId) continue;
    sumW += weighted.weight;
    sumW2 += weighted.weight * weighted.weight;
    if (weighted.game.win) winsW += weighted.weight;
    rawGames += 1;
  }
  const nEff = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  return {
    winRate: sumW > 0 ? winsW / sumW : null,
    nEff,
    games: rawGames,
    insufficientData: nEff < minGames,
  };
}
