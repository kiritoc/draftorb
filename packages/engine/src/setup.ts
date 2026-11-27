/**
 * @draftorb/engine — Setup-screen rune data path (SPECS §8.1/§18.5, BL-030a,
 * D-102/D-103/D-134).
 *
 * Pure, deterministic. `recommendSetupRunes` is the mode-switched entry
 * point behind the runes screen: `topPlayers` consumes the expert aggregate
 * export (`recommendRunes`, §8.1) and `myData` consumes the configured
 * profile export (`recommendProfileRunes`, D-073/D-075). Switching modes is
 * a pure re-query — no restart, no hidden state.
 *
 * Both modes normalize to `SetupRuneResult`: every page carries its sample
 * size (`nEff`; `games` for profile figures) and, for expert figures, the
 * distinct-player count (`players`); win rate and pick share stay separate
 * fields; the evidence block reports the applied D-102 rule (per-player cap,
 * minimum distinct players, Master+ toggle off by default and labeled
 * optional). When the mode's primary data is too thin — no page clears the
 * evidence gate — `broaderStatistic` carries the labeled D-103 fallback
 * (champion win rate in the role) instead of a bare empty state.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import {
  SETUP_RESULT_SCHEMA_VERSION,
  SETUP_SPELLS_RESULT_SCHEMA_VERSION,
  SETUP_STARTERS_RESULT_SCHEMA_VERSION,
  type BaselineTable,
  type ChampionId,
  type DraftInput,
  type ProfileExport,
  type RuneExport,
  type RuneRecommendData,
  type SetupBroaderStatistic,
  type SetupEvidence,
  type SetupMode,
  type SetupPageSource,
  type SetupRunePage,
  type SetupRuneResult,
  type SetupSpellPick,
  type SetupSpellsResult,
  type SetupStarterPick,
  type SetupStarterSource,
  type SetupStartersResult,
  type StarterChampionExport,
  type StarterRoleExport,
  type SummonerExport,
} from '@draftorb/shared';

import {
  DEFAULT_CONFIG,
  DEFAULT_RUNE_CONFIG,
  DEFAULT_STARTER_CONFIG,
  DEFAULT_SUMMONER_CONFIG,
  rankToBucket,
  type RankWeightingConfig,
  type RuneConfig,
  type StarterConfig,
  type SummonerConfig,
} from './config.js';
import { baselinePrior, isLowData } from './levels.js';
import {
  DEFAULT_PERSONALIZE_CONFIG,
  personalizeContext,
  type PersonalizeConfig,
} from './personalize.js';
import { indexBaselines } from './recommend-indexes.js';
import { recommendRunes } from './runes.js';
import { recommendSummoners } from './summoners.js';
import { recommendStarters } from './starters.js';
import {
  DEFAULT_MIN_SETUP_GAMES,
  profileChampionWinRate,
  recommendProfileRunes,
  recommendProfileSpells,
} from './profile-setup.js';

/**
 * Data the setup rune path needs: the rune recommender's role probabilities
 * and champion tags, plus the role baseline table for the D-103 broader
 * statistic. `RecommendData` satisfies this structurally.
 */
export interface SetupRunesData extends RuneRecommendData {
  readonly baselines: BaselineTable;
}

export interface RecommendSetupRunesOptions {
  /** Active setup mode; switching it is a pure re-query (D-134). */
  readonly mode: SetupMode;
  /** `roles/<ROLE>/runes/<championId>.json` export (topPlayers mode). */
  readonly runeExport?: RuneExport;
  /** Configured profile export (myData mode); absent -> insufficient state. */
  readonly profile?: ProfileExport;
  readonly nowMs: number;
  readonly config?: RankWeightingConfig;
  readonly runeConfig?: RuneConfig;
  readonly personalizeConfig?: PersonalizeConfig;
  /** D-075 minimum effective games for profile figures. */
  readonly minSetupGames?: number;
  /** Profile page count (mirrors `topPages`). */
  readonly topPicks?: number;
}

/** Map an expert `contextLevel` (1..3 lane, 4 damage mix, 5 global) to its label. */
function expertPageSource(contextLevel: number): SetupPageSource {
  if (contextLevel <= 3) return 'laneContext';
  if (contextLevel === 4) return 'damageMix';
  return 'global';
}

/** Map a profile fallback level (L1..L3 matchup, L4..L5 champion) to its label. */
function profilePageSource(fallbackLevel: number | null): SetupPageSource {
  if (fallbackLevel === null) return 'none';
  return fallbackLevel <= 3 ? 'profileMatchup' : 'profileChampion';
}

function expertPages(
  result: ReturnType<typeof recommendRunes>,
  config: RankWeightingConfig,
): SetupRunePage[] {
  return result.pages.map((page) => ({
    keystoneId: page.keystoneId,
    primaryStyleId: page.primaryStyleId,
    subStyleId: page.subStyleId,
    perkIds: [...page.selectedPerkIds],
    statShardIds: [...(page.statShardIds ?? [])],
    winRate: page.winRate,
    nEff: page.nEff,
    ...(page.players !== undefined ? { players: page.players } : {}),
    pickShare: page.pickShare,
    // D-102/D-103: a page only counts as sufficient evidence when it clears
    // the distinct-player gate and is not flagged lowData by recommendRunes.
    // A missing `players` count cannot prove the D-102 minimum, so it fails
    // closed. Thin pages stay listed but labeled `insufficientData`, and the
    // D-103 broader statistic surfaces when no page is sufficient.
    insufficientData:
      page.lowData ||
      page.players === undefined ||
      page.players < config.evidenceMinDistinctPlayers,
    source: expertPageSource(page.contextLevel),
    sourceLevel: page.contextLevel,
  }));
}

function profilePages(picks: ReturnType<typeof recommendProfileRunes>): SetupRunePage[] {
  return picks.map((pick) => ({
    keystoneId: pick.keystoneId,
    primaryStyleId: pick.primaryStyleId,
    subStyleId: pick.subStyleId,
    perkIds: [...pick.perkIds],
    statShardIds: [...pick.statShardIds],
    winRate: pick.winRate,
    nEff: pick.nEff,
    games: pick.games,
    insufficientData: pick.insufficientData,
    source: profilePageSource(pick.fallbackLevel),
    sourceLevel: pick.fallbackLevel,
  }));
}

/**
 * D-103 fallback for the top-players mode: the champion's win rate in the
 * picked role from the role baseline table, shrunk like the pick-screen
 * baseline prior. `winRate` is null only when there is no weighted evidence;
 * `insufficientData` flags samples below `minGames` (D-129 convention).
 */
function championRoleBroaderStatistic(
  input: DraftInput,
  championId: ChampionId,
  data: SetupRunesData,
  config: RankWeightingConfig,
): SetupBroaderStatistic {
  const bucket = config.evidenceMasterPlusOnly ? 'MASTER_PLUS' : rankToBucket(input.userRank);
  const row = indexBaselines(data.baselines, bucket).get(championId);
  if (row === undefined) {
    return {
      kind: 'championRoleWinRate',
      winRate: null,
      nEff: 0,
      insufficientData: true,
    };
  }
  return {
    kind: 'championRoleWinRate',
    winRate: row.gamesE > 0 ? baselinePrior(row.winsE, row.gamesE, config.k0) : null,
    nEff: row.nE,
    ...(row.rawGames !== undefined && row.rawGames > 0 ? { games: row.rawGames } : {}),
    insufficientData: isLowData(row.nE, config.minGames),
  };
}

/**
 * Mode-switched rune setup result for the picked champion (SPECS §18.5,
 * D-134). Pure: callers re-invoke with a different `mode` to switch sources
 * without restarting anything.
 */
export function recommendSetupRunes(
  input: DraftInput,
  championId: ChampionId,
  data: SetupRunesData,
  options: RecommendSetupRunesOptions,
): SetupRuneResult {
  const myRole = input.userRole;
  const base = {
    schemaVersion: SETUP_RESULT_SCHEMA_VERSION,
    championId,
    myRole,
  } as const;

  if (options.mode === 'myData') {
    const minSetupGames = options.minSetupGames ?? DEFAULT_MIN_SETUP_GAMES;
    const personalizeConfig = options.personalizeConfig ?? DEFAULT_PERSONALIZE_CONFIG;
    const evidence: SetupEvidence = { kind: 'profile', minSetupGames };
    const profile = options.profile;
    if (profile === undefined) {
      return {
        ...base,
        mode: 'myData',
        dataSource: 'profile',
        evidence,
        pages: [],
        broaderStatistic: null,
        dataAvailable: false,
      };
    }
    const context = personalizeContext(input, data);
    const picks = recommendProfileRunes(profile, championId, myRole, context, data, options.nowMs, {
      config: personalizeConfig,
      minSetupGames,
      ...(options.topPicks !== undefined ? { topPicks: options.topPicks } : {}),
    });
    const pages = profilePages(picks);
    const dataAvailable = pages.some((page) => !page.insufficientData);
    const stat = profileChampionWinRate(profile, championId, myRole, data, options.nowMs, {
      config: personalizeConfig,
      minSetupGames,
    });
    const broaderStatistic: SetupBroaderStatistic = {
      kind: 'profileChampionWinRate',
      winRate: stat.winRate,
      nEff: stat.nEff,
      games: stat.games,
      insufficientData: stat.insufficientData,
    };
    return {
      ...base,
      mode: 'myData',
      dataSource: 'profile',
      evidence,
      pages,
      broaderStatistic: dataAvailable ? null : broaderStatistic,
      dataAvailable,
    };
  }

  const config = options.config ?? DEFAULT_CONFIG;
  const runeConfig = options.runeConfig ?? DEFAULT_RUNE_CONFIG;
  const result = recommendRunes(input, championId, options.runeExport, data, config, runeConfig);
  const evidence: SetupEvidence = {
    kind: 'expert',
    playerWeightCap: config.evidencePlayerWeightCap,
    minDistinctPlayers: config.evidenceMinDistinctPlayers,
    masterPlusOnly: config.evidenceMasterPlusOnly,
    masterPlusOptional: true,
  };
  const pages = expertPages(result, config);
  // `recommendRunes` reports dataAvailable for any matched context, even
  // when every page is thin; here availability means at least one page
  // clears the D-102/D-103 evidence gate, otherwise the labeled broader
  // statistic replaces the rune pages (D-103).
  const dataAvailable = pages.some((page) => !page.insufficientData);
  return {
    ...base,
    mode: 'topPlayers',
    dataSource: 'expertAggregate',
    evidence,
    pages,
    broaderStatistic: dataAvailable
      ? null
      : championRoleBroaderStatistic(input, championId, data, config),
    dataAvailable,
  };
}

// --- Summoner spells and starter items (BL-031b, SPECS §18.5) ---
//
// Both sections reuse the rune result contract: the same `SetupMode`
// switch, `SetupEvidence` block, `SetupBroaderStatistic` D-103 fallback and
// `dataAvailable` semantics. Expert picks go through the D-102 gate
// (lowData OR missing/insufficient `players` -> `insufficientData`), exactly
// like `expertPages` above.

/** The data the spell/starter setup paths need (rune data + baselines). */
export type SetupSpellsData = SetupRunesData;
export type SetupStartersData = SetupRunesData;

export interface RecommendSetupSpellsOptions {
  /** Active setup mode; switching it is a pure re-query (D-134). */
  readonly mode: SetupMode;
  /** `roles/<ROLE>/summoners/<championId>.json` export (topPlayers mode). */
  readonly summonerExport?: SummonerExport;
  /** Configured profile export (myData mode); absent -> insufficient state. */
  readonly profile?: ProfileExport;
  readonly nowMs: number;
  readonly config?: RankWeightingConfig;
  readonly summonerConfig?: SummonerConfig;
  readonly personalizeConfig?: PersonalizeConfig;
  /** D-075 minimum effective games for profile figures. */
  readonly minSetupGames?: number;
  /** Profile pick count (mirrors `topPairs`/`topPicks`). */
  readonly topPicks?: number;
}

export interface RecommendSetupStartersOptions {
  /** Active setup mode; switching it is a pure re-query (D-134). */
  readonly mode: SetupMode;
  /** `roles/<ROLE>/starters/<championId>.json` export (topPlayers mode). */
  readonly championExport?: StarterChampionExport;
  /** `roles/<ROLE>/starters.json` role/global fallback export. */
  readonly roleExport?: StarterRoleExport;
  /**
   * Configured profile export (myData mode). The profile export records no
   * starter-window purchases, so myData starters always report the
   * insufficient-data state — the profile only feeds the labeled D-103
   * broader statistic (D-139 PROPOSED).
   */
  readonly profile?: ProfileExport;
  readonly nowMs: number;
  readonly config?: RankWeightingConfig;
  readonly starterConfig?: StarterConfig;
  readonly personalizeConfig?: PersonalizeConfig;
  /** D-075 minimum effective games for the profile broader statistic. */
  readonly minSetupGames?: number;
}

/** D-102 sufficiency gate shared by every expert setup pick. */
function expertPickInsufficientData(
  lowData: boolean,
  players: number | undefined,
  config: RankWeightingConfig,
): boolean {
  return lowData || players === undefined || players < config.evidenceMinDistinctPlayers;
}

function expertEvidence(config: RankWeightingConfig): SetupEvidence {
  return {
    kind: 'expert',
    playerWeightCap: config.evidencePlayerWeightCap,
    minDistinctPlayers: config.evidenceMinDistinctPlayers,
    masterPlusOnly: config.evidenceMasterPlusOnly,
    masterPlusOptional: true,
  };
}

function profileEvidence(minSetupGames: number): SetupEvidence {
  return { kind: 'profile', minSetupGames };
}

function expertSpellPicks(
  result: ReturnType<typeof recommendSummoners>,
  config: RankWeightingConfig,
): SetupSpellPick[] {
  return result.pairs.map((pick) => ({
    spell1Id: Math.min(pick.summoner1Id, pick.summoner2Id),
    spell2Id: Math.max(pick.summoner1Id, pick.summoner2Id),
    winRate: pick.winRate,
    nEff: pick.nEff,
    ...(pick.players !== undefined ? { players: pick.players } : {}),
    pickShare: pick.pickShare,
    insufficientData: expertPickInsufficientData(pick.lowData, pick.players, config),
    source: expertPageSource(pick.contextLevel),
    sourceLevel: pick.contextLevel,
  }));
}

function profileSpellPicks(picks: ReturnType<typeof recommendProfileSpells>): SetupSpellPick[] {
  return picks.map((pick) => ({
    spell1Id: Math.min(pick.spells[0], pick.spells[1]),
    spell2Id: Math.max(pick.spells[0], pick.spells[1]),
    winRate: pick.winRate,
    nEff: pick.nEff,
    games: pick.games,
    insufficientData: pick.insufficientData,
    source: profilePageSource(pick.fallbackLevel),
    sourceLevel: pick.fallbackLevel,
  }));
}

/** Map a starter back-off level (1 lane, 2 champion, 3 role, 4 global). */
function starterPageSource(contextLevel: number): SetupStarterSource {
  switch (contextLevel) {
    case 1:
      return 'laneContext';
    case 2:
      return 'championContext';
    case 3:
      return 'roleContext';
    default:
      return 'global';
  }
}

function expertStarterPicks(
  result: ReturnType<typeof recommendStarters>,
  config: RankWeightingConfig,
): SetupStarterPick[] {
  return result.bundles.map((pick) => ({
    items: pick.items.map((item) => ({ itemId: item.itemId, count: item.count })),
    winRate: pick.winRate,
    nEff: pick.nEff,
    ...(pick.players !== undefined ? { players: pick.players } : {}),
    pickShare: pick.pickShare,
    insufficientData: expertPickInsufficientData(pick.lowData, pick.players, config),
    source: starterPageSource(pick.contextLevel),
    sourceLevel: pick.contextLevel,
  }));
}

/**
 * Mode-switched summoner-spell setup result for the picked champion
 * (SPECS §18.5, BL-031b). `topPlayers` consumes the expert summoner export
 * through `recommendSummoners`; `myData` consumes the profile export through
 * `recommendProfileSpells` (unordered normalized pair, profile win rate).
 */
export function recommendSetupSpells(
  input: DraftInput,
  championId: ChampionId,
  data: SetupSpellsData,
  options: RecommendSetupSpellsOptions,
): SetupSpellsResult {
  const myRole = input.userRole;
  const base = {
    schemaVersion: SETUP_SPELLS_RESULT_SCHEMA_VERSION,
    championId,
    myRole,
  } as const;

  if (options.mode === 'myData') {
    const minSetupGames = options.minSetupGames ?? DEFAULT_MIN_SETUP_GAMES;
    const personalizeConfig = options.personalizeConfig ?? DEFAULT_PERSONALIZE_CONFIG;
    const evidence = profileEvidence(minSetupGames);
    const profile = options.profile;
    if (profile === undefined) {
      return {
        ...base,
        mode: 'myData',
        dataSource: 'profile',
        evidence,
        picks: [],
        broaderStatistic: null,
        dataAvailable: false,
      };
    }
    const context = personalizeContext(input, data);
    const profilePicks = recommendProfileSpells(
      profile,
      championId,
      myRole,
      context,
      data,
      options.nowMs,
      {
        config: personalizeConfig,
        minSetupGames,
        ...(options.topPicks !== undefined ? { topPicks: options.topPicks } : {}),
      },
    );
    const picks = profileSpellPicks(profilePicks);
    const dataAvailable = picks.some((pick) => !pick.insufficientData);
    const stat = profileChampionWinRate(profile, championId, myRole, data, options.nowMs, {
      config: personalizeConfig,
      minSetupGames,
    });
    const broaderStatistic: SetupBroaderStatistic = {
      kind: 'profileChampionWinRate',
      winRate: stat.winRate,
      nEff: stat.nEff,
      games: stat.games,
      insufficientData: stat.insufficientData,
    };
    return {
      ...base,
      mode: 'myData',
      dataSource: 'profile',
      evidence,
      picks,
      broaderStatistic: dataAvailable ? null : broaderStatistic,
      dataAvailable,
    };
  }

  const config = options.config ?? DEFAULT_CONFIG;
  const summonerConfig = options.summonerConfig ?? DEFAULT_SUMMONER_CONFIG;
  const result = recommendSummoners(
    input,
    championId,
    options.summonerExport,
    data,
    config,
    summonerConfig,
  );
  const picks = expertSpellPicks(result, config);
  const dataAvailable = picks.some((pick) => !pick.insufficientData);
  return {
    ...base,
    mode: 'topPlayers',
    dataSource: 'expertAggregate',
    evidence: expertEvidence(config),
    picks,
    broaderStatistic: dataAvailable
      ? null
      : championRoleBroaderStatistic(input, championId, data, config),
    dataAvailable,
  };
}

/**
 * Mode-switched starter-item setup result for the picked champion
 * (SPECS §18.5, BL-031b). `topPlayers` consumes the expert starter exports
 * (`starter_ctx` bundles within `starterWindowSeconds`, D-086/D-134) through
 * `recommendStarters`; `myData` has no profile starter source — the profile
 * export records no starter-window purchases, so it always reports the
 * insufficient-data state with the labeled D-103 profile broader statistic
 * (D-139 PROPOSED).
 */
export function recommendSetupStarters(
  input: DraftInput,
  championId: ChampionId,
  data: SetupStartersData,
  options: RecommendSetupStartersOptions,
): SetupStartersResult {
  const myRole = input.userRole;
  const base = {
    schemaVersion: SETUP_STARTERS_RESULT_SCHEMA_VERSION,
    championId,
    myRole,
  } as const;

  if (options.mode === 'myData') {
    const minSetupGames = options.minSetupGames ?? DEFAULT_MIN_SETUP_GAMES;
    const personalizeConfig = options.personalizeConfig ?? DEFAULT_PERSONALIZE_CONFIG;
    const profile = options.profile;
    if (profile === undefined) {
      return {
        ...base,
        mode: 'myData',
        dataSource: 'profile',
        evidence: profileEvidence(minSetupGames),
        picks: [],
        broaderStatistic: null,
        dataAvailable: false,
      };
    }
    const stat = profileChampionWinRate(profile, championId, myRole, data, options.nowMs, {
      config: personalizeConfig,
      minSetupGames,
    });
    const broaderStatistic: SetupBroaderStatistic = {
      kind: 'profileChampionWinRate',
      winRate: stat.winRate,
      nEff: stat.nEff,
      games: stat.games,
      insufficientData: stat.insufficientData,
    };
    return {
      ...base,
      mode: 'myData',
      dataSource: 'profile',
      evidence: profileEvidence(minSetupGames),
      picks: [],
      broaderStatistic,
      dataAvailable: false,
    };
  }

  const config = options.config ?? DEFAULT_CONFIG;
  const starterConfig = options.starterConfig ?? DEFAULT_STARTER_CONFIG;
  const result = recommendStarters(
    input,
    championId,
    options.championExport,
    options.roleExport,
    data,
    config,
    starterConfig,
  );
  const picks = expertStarterPicks(result, config);
  const dataAvailable = picks.some((pick) => !pick.insufficientData);
  return {
    ...base,
    mode: 'topPlayers',
    dataSource: 'expertAggregate',
    evidence: expertEvidence(config),
    picks,
    broaderStatistic: dataAvailable
      ? null
      : championRoleBroaderStatistic(input, championId, data, config),
    dataAvailable,
  };
}
