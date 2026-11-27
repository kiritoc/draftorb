/**
 * Setup-screen rune data path (BL-030a, SPECS §18.5, D-134).
 *
 * Loads the per-champion rune export `roles/<ROLE>/runes/<championId>.json`
 * lazily from the aggregate cache (a missing file means "no rune data",
 * never an error — same contract as the web loader) and runs the
 * mode-switched engine entry point `recommendSetupRunes`. `topPlayers`
 * reads the expert aggregate; `myData` reads the configured profile export
 * supplied by the caller. Switching `mode` and calling again re-queries
 * both sources without any restart or hidden state.
 */

import {
  runeExportSchema,
  type ChampionId,
  type DraftInput,
  type ProfileExport,
  type Role,
  type RuneExport,
  type SetupMode,
  type SetupRuneResult,
} from '@draftorb/shared';
import {
  recommendSetupRunes,
  type RankWeightingConfig,
  type PersonalizeConfig,
  type RuneConfig,
} from '@draftorb/engine';

import { cacheRead } from './aggregates';
import { loadCachedRelease } from './export-data';
import type { PickData } from './export-data';

/**
 * First manifest schema whose rune exports apply the D-102 evidence rule
 * (per-player weight cap, minimum distinct players, `players` field —
 * BL-013a claimed schema v6). A v5 cache predates the mechanism entirely:
 * its rune figures cannot be verified against the evidence rules the
 * result reports, so they are treated as absent and the labeled D-103
 * broader-statistic fallback shows instead (fail-closed).
 */
const MIN_RUNE_EVIDENCE_MANIFEST_VERSION = 6;

/**
 * Loads `roles/<role>/runes/<championId>.json` from the data cache.
 * Returns null when nothing is cached, the champion has no export, or the
 * cached release predates the D-102 rune evidence rule; throws on a
 * corrupt file (fail-closed, like every manifest file).
 */
export async function loadRuneExport(
  role: Role,
  championId: ChampionId,
): Promise<RuneExport | null> {
  const release = await loadCachedRelease();
  if (release === null) return null;
  if (release.manifest.schemaVersion < MIN_RUNE_EVIDENCE_MANIFEST_VERSION) {
    return null;
  }
  const raw = await cacheRead(
    `${release.latest.patch}/roles/${role}/runes/${championId}.json`,
  );
  if (raw === null) return null;
  return runeExportSchema.parse(JSON.parse(raw));
}

export interface SetupRunesQuery {
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
  readonly runeConfig?: RuneConfig;
  readonly personalizeConfig?: PersonalizeConfig;
  readonly minSetupGames?: number;
  readonly topPicks?: number;
}

/**
 * Computes the setup rune result for `query.mode`. Always returns a result:
 * a missing rune export or profile export is an insufficient-data result
 * with the labeled D-103 fallback, never null (the caller already holds
 * `pickData`, so a cached release exists).
 */
export async function loadSetupRunes(
  query: SetupRunesQuery,
): Promise<SetupRuneResult> {
  // The rune export is only needed for the expert mode; myData never touches
  // it, so a mode switch costs one cache read at most.
  const runeExport =
    query.mode === 'topPlayers'
      ? ((await loadRuneExport(query.draft.userRole, query.championId)) ?? undefined)
      : undefined;
  return recommendSetupRunes(query.draft, query.championId, query.pickData.data, {
    mode: query.mode,
    ...(runeExport !== undefined ? { runeExport } : {}),
    ...(query.profile !== undefined ? { profile: query.profile } : {}),
    nowMs: query.nowMs ?? Date.now(),
    ...(query.config !== undefined ? { config: query.config } : {}),
    ...(query.runeConfig !== undefined ? { runeConfig: query.runeConfig } : {}),
    ...(query.personalizeConfig !== undefined
      ? { personalizeConfig: query.personalizeConfig }
      : {}),
    ...(query.minSetupGames !== undefined ? { minSetupGames: query.minSetupGames } : {}),
    ...(query.topPicks !== undefined ? { topPicks: query.topPicks } : {}),
  });
}
