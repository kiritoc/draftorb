/**
 * Setup-screen summoner-spell data path (BL-031b, SPECS §8.3/§18.5, D-134).
 *
 * Loads the per-champion summoner export
 * `roles/<ROLE>/summoners/<championId>.json` lazily from the aggregate
 * cache (a missing file means "no summoner data", never an error — same
 * contract as the rune loader) and runs the mode-switched engine entry
 * point `recommendSetupSpells`. `topPlayers` reads the expert aggregate;
 * `myData` reads the configured profile export supplied by the caller.
 * Switching `mode` and calling again re-queries both sources without any
 * restart or hidden state.
 */

import {
  summonerExportSchema,
  type ChampionId,
  type DraftInput,
  type ProfileExport,
  type Role,
  type SetupMode,
  type SetupSpellsResult,
  type SummonerExport,
} from '@draftorb/shared';
import {
  recommendSetupSpells,
  type PersonalizeConfig,
  type RankWeightingConfig,
  type SummonerConfig,
} from '@draftorb/engine';

import { cacheRead } from './aggregates';
import { loadCachedRelease, manifestListsFile } from './export-data';
import type { PickData } from './export-data';

/**
 * First manifest schema whose summoner exports exist and apply the D-102
 * evidence rule (per-player weight cap, minimum distinct players, `players`
 * field — BL-031a claimed schema v8). A v7-or-older cache predates the
 * files entirely, so its summoner figures cannot be verified against the
 * evidence rules the result reports: they are treated as absent and the
 * labeled D-103 broader-statistic fallback shows instead (fail-closed).
 */
const MIN_SUMMONER_EVIDENCE_MANIFEST_VERSION = 8;

/**
 * Loads `roles/<role>/summoners/<championId>.json` from the data cache.
 * Returns null when nothing is cached, the champion has no export, the
 * cached release predates the summoner exports, or the file is absent
 * from the current manifest (a same-patch refresh may have dropped it —
 * the stale cache copy must not be served); throws on a corrupt file
 * (fail-closed, like every manifest file).
 */
export async function loadSummonerExport(
  role: Role,
  championId: ChampionId,
): Promise<SummonerExport | null> {
  const release = await loadCachedRelease();
  if (release === null) return null;
  if (release.manifest.schemaVersion < MIN_SUMMONER_EVIDENCE_MANIFEST_VERSION) {
    return null;
  }
  const path = `roles/${role}/summoners/${championId}.json`;
  if (!manifestListsFile(release.manifest, path)) return null;
  const raw = await cacheRead(`${release.latest.patch}/${path}`);
  if (raw === null) return null;
  return summonerExportSchema.parse(JSON.parse(raw));
}

export interface SetupSpellsQuery {
  /** Active mode; re-calling with the other mode re-queries the source. */
  readonly mode: SetupMode;
  readonly championId: ChampionId;
  /** The draft input; `userRole` selects the role folder and result role. */
  readonly draft: DraftInput;
  /** Pick-screen dataset for the same role (provides baselines/roleProb/tags). */
  readonly pickData: PickData;
  /** Profile export for `myData` mode; ignored by `topPlayers`. */
  readonly profile?: ProfileExport;
  /** Timestamp for profile recency weighting; defaults to `Date.now()`. */
  readonly nowMs?: number;
  readonly config?: RankWeightingConfig;
  readonly summonerConfig?: SummonerConfig;
  readonly personalizeConfig?: PersonalizeConfig;
  readonly minSetupGames?: number;
  readonly topPicks?: number;
}

/**
 * Computes the setup summoner-spell result for `query.mode`. Always returns
 * a result: a missing summoner export or profile export is an
 * insufficient-data result with the labeled D-103 fallback, never null
 * (the caller already holds `pickData`, so a cached release exists).
 */
export async function loadSetupSpells(
  query: SetupSpellsQuery,
): Promise<SetupSpellsResult> {
  // The summoner export is only needed for the expert mode; myData never
  // touches it, so a mode switch costs one cache read at most.
  const summonerExport =
    query.mode === 'topPlayers'
      ? ((await loadSummonerExport(query.draft.userRole, query.championId)) ?? undefined)
      : undefined;
  return recommendSetupSpells(query.draft, query.championId, query.pickData.data, {
    mode: query.mode,
    ...(summonerExport !== undefined ? { summonerExport } : {}),
    ...(query.profile !== undefined ? { profile: query.profile } : {}),
    nowMs: query.nowMs ?? Date.now(),
    ...(query.config !== undefined ? { config: query.config } : {}),
    ...(query.summonerConfig !== undefined ? { summonerConfig: query.summonerConfig } : {}),
    ...(query.personalizeConfig !== undefined
      ? { personalizeConfig: query.personalizeConfig }
      : {}),
    ...(query.minSetupGames !== undefined ? { minSetupGames: query.minSetupGames } : {}),
    ...(query.topPicks !== undefined ? { topPicks: query.topPicks } : {}),
  });
}
