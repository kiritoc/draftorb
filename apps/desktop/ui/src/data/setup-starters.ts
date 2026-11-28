/**
 * Setup-screen starter-item data path (BL-031b, SPECS §8.3/§18.5, D-134,
 * D-086 bundle half).
 *
 * Loads the per-champion starter export
 * `roles/<ROLE>/starters/<championId>.json` plus the role/global fallback
 * `roles/<ROLE>/starters.json` lazily from the aggregate cache (a missing
 * file means "no starter data", never an error — same contract as the rune
 * loader) and runs the mode-switched engine entry point
 * `recommendSetupStarters`. `topPlayers` reads the expert aggregates;
 * `myData` reads the profile export — schema v3 exports carry the per-game
 * starter-window bundles recorded by `profile-sync` (BL-059); older exports
 * report the insufficient-data state with the labeled D-103 broader
 * statistic (D-139).
 */

import {
  starterChampionExportSchema,
  starterRoleExportSchema,
  type ChampionId,
  type DraftInput,
  type ProfileExport,
  type Role,
  type SetupMode,
  type SetupStartersResult,
  type StarterChampionExport,
  type StarterRoleExport,
} from '@draftorb/shared';
import {
  recommendSetupStarters,
  type PersonalizeConfig,
  type RankWeightingConfig,
  type StarterConfig,
} from '@draftorb/engine';

import { cacheRead } from './aggregates';
import { loadCachedRelease, manifestListsFile } from './export-data';
import type { PickData } from './export-data';

/**
 * First manifest schema whose starter exports exist and apply the D-102
 * evidence rule (BL-031a claimed schema v8). A v7-or-older cache predates
 * the files entirely: its starter figures cannot be verified against the
 * evidence rules the result reports, so they are treated as absent and the
 * labeled D-103 broader-statistic fallback shows instead (fail-closed).
 */
const MIN_STARTER_EVIDENCE_MANIFEST_VERSION = 8;

export interface StarterExports {
  readonly championExport?: StarterChampionExport;
  readonly roleExport?: StarterRoleExport;
}

/**
 * Loads `roles/<role>/starters/<championId>.json` and
 * `roles/<role>/starters.json` from the data cache. Each file is optional:
 * a missing champion file drops the lane/champion levels, a missing role
 * file drops the role/global levels — the recommender back-offs over
 * whatever exists. A file absent from the current manifest is treated as
 * missing even when a stale cache copy survives a same-patch refresh.
 * Returns empty exports when nothing is cached or the release predates
 * the starter exports; throws on a corrupt file (fail-closed, like every
 * manifest file).
 */
export async function loadStarterExports(
  role: Role,
  championId: ChampionId,
): Promise<StarterExports> {
  const release = await loadCachedRelease();
  if (release === null) return {};
  if (release.manifest.schemaVersion < MIN_STARTER_EVIDENCE_MANIFEST_VERSION) {
    return {};
  }
  const patch = release.latest.patch;
  const championPath = `roles/${role}/starters/${championId}.json`;
  const rolePath = `roles/${role}/starters.json`;
  const [championRaw, roleRaw] = await Promise.all([
    manifestListsFile(release.manifest, championPath)
      ? cacheRead(`${patch}/${championPath}`)
      : Promise.resolve(null),
    manifestListsFile(release.manifest, rolePath)
      ? cacheRead(`${patch}/${rolePath}`)
      : Promise.resolve(null),
  ]);
  return {
    ...(championRaw !== null
      ? { championExport: starterChampionExportSchema.parse(JSON.parse(championRaw)) }
      : {}),
    ...(roleRaw !== null
      ? { roleExport: starterRoleExportSchema.parse(JSON.parse(roleRaw)) }
      : {}),
  };
}

export interface SetupStartersQuery {
  /** Active mode; re-calling with the other mode re-queries the source. */
  readonly mode: SetupMode;
  readonly championId: ChampionId;
  /** The draft input; `userRole` selects the role folder and result role. */
  readonly draft: DraftInput;
  /** Pick-screen dataset for the same role (provides baselines/roleProb/tags). */
  readonly pickData: PickData;
  /** Profile export for `myData` mode (starter bundles + broader statistic); ignored by `topPlayers`. */
  readonly profile?: ProfileExport;
  /** Timestamp for profile recency weighting; defaults to `Date.now()`. */
  readonly nowMs?: number;
  readonly config?: RankWeightingConfig;
  readonly starterConfig?: StarterConfig;
  readonly personalizeConfig?: PersonalizeConfig;
  readonly minSetupGames?: number;
}

/**
 * Computes the setup starter-item result for `query.mode`. Always returns a
 * result: missing starter exports or a missing profile export is an
 * insufficient-data result with the labeled D-103 fallback, never null
 * (the caller already holds `pickData`, so a cached release exists).
 */
export async function loadSetupStarters(
  query: SetupStartersQuery,
): Promise<SetupStartersResult> {
  // The starter exports are only needed for the expert mode; myData reads
  // the profile export instead, so a mode switch costs at most two cache
  // reads.
  const exports =
    query.mode === 'topPlayers'
      ? await loadStarterExports(query.draft.userRole, query.championId)
      : {};
  return recommendSetupStarters(query.draft, query.championId, query.pickData.data, {
    mode: query.mode,
    ...(exports.championExport !== undefined
      ? { championExport: exports.championExport }
      : {}),
    ...(exports.roleExport !== undefined ? { roleExport: exports.roleExport } : {}),
    ...(query.profile !== undefined ? { profile: query.profile } : {}),
    nowMs: query.nowMs ?? Date.now(),
    ...(query.config !== undefined ? { config: query.config } : {}),
    ...(query.starterConfig !== undefined ? { starterConfig: query.starterConfig } : {}),
    ...(query.personalizeConfig !== undefined
      ? { personalizeConfig: query.personalizeConfig }
      : {}),
    ...(query.minSetupGames !== undefined ? { minSetupGames: query.minSetupGames } : {}),
  });
}
