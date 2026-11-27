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
 * size (`nEff`, `games`) and, for expert figures, the distinct-player count
 * (`players`); win rate and pick share stay separate fields; the evidence
 * block reports the applied D-102 rule (per-player cap, minimum distinct
 * players, Master+ toggle off by default and labeled optional). When the
 * mode's primary data is too thin, `broaderStatistic` carries the labeled
 * D-103 fallback (champion win rate in the role) instead of a bare empty
 * state.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import {
  SETUP_RESULT_SCHEMA_VERSION,
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
} from '@draftorb/shared';

import {
  DEFAULT_CONFIG,
  DEFAULT_RUNE_CONFIG,
  rankToBucket,
  type RankWeightingConfig,
  type RuneConfig,
} from './config.js';
import { baselinePrior, isLowData } from './levels.js';
import {
  DEFAULT_PERSONALIZE_CONFIG,
  personalizeContext,
  type PersonalizeConfig,
} from './personalize.js';
import { indexBaselines } from './recommend-indexes.js';
import { recommendRunes } from './runes.js';
import {
  DEFAULT_MIN_SETUP_GAMES,
  profileChampionWinRate,
  recommendProfileRunes,
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

function expertPages(result: ReturnType<typeof recommendRunes>): SetupRunePage[] {
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
    insufficientData: false,
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
  return {
    ...base,
    mode: 'topPlayers',
    dataSource: 'expertAggregate',
    evidence,
    pages: expertPages(result),
    broaderStatistic: result.dataAvailable
      ? null
      : championRoleBroaderStatistic(input, championId, data, config),
    dataAvailable: result.dataAvailable,
  };
}
