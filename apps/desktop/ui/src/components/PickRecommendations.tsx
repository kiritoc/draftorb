/**
 * Recommendation lists section of the pick screen (BL-016b, SPECS §7.1):
 * "From your pool" above "Best overall", the empty-pool call to action,
 * the UI-only "Hide my pool" toggle, dropped-champion notices and the
 * pool editor modal. All list shaping (pick exclusion, rank-gap closing,
 * pool filtering) lives here; the screen only supplies engine output.
 */

import { useMemo, useState, type ReactElement } from 'react';

import type {
  Champion,
  ChampionId,
  InsufficientDataEntry,
  PickRate,
  PickRateSamples,
  PoolConfig,
  PoolUnavailableEntry,
  RankBucket,
  Recommendation,
  Role,
} from '@draftorb/shared';
import type { ProfileLoad } from '../profile/profile-export';
import type { BaselineIndex } from '../pick/baseline-record';
import { excludePick, excludedRanks } from '../pick/exclude-pick';
import { hidePoolChampions } from '../pick/hide-my-pool';
import { buildInsufficientItems } from '../pick/insufficient-items';
import { buildPoolUnavailableItems } from '../pick/pool-unavailable';
import { championName } from '../champion-name';
import { RecommendationsList, type RecommendationCardContext } from './RecommendationsList';
import { PoolEditor } from './PoolEditor';
import { strings } from '../strings';

export interface PickRecommendationsProps {
  role: Role;
  /** Champion ids of the current role's pool (drives the "From your pool" list). */
  poolIds: readonly number[];
  /** Full program-stored pool, handed to the editor. */
  poolConfig: PoolConfig;
  champions: Champion[];
  iconVersion?: string | null;
  profileLoad: ProfileLoad;
  /** Baseline lookup + rank bucket for the champion-average badge row (BL-051). */
  baselineIndex?: BaselineIndex;
  rankBucket?: RankBucket;
  /** Pick-share export + denominators for the card figure (BL-052). */
  pickRate?: PickRate;
  pickRateSamples?: PickRateSamples;
  /** The user's own pick: excluded from both lists with rank-gap closing. */
  userChampionId: ChampionId | null;
  recommendations: readonly Recommendation[];
  poolRecommendations: readonly Recommendation[];
  poolUnavailable: readonly PoolUnavailableEntry[];
  insufficientData: readonly InsufficientDataEntry[];
  resetKey: unknown;
  repoFolder?: string;
  /** Persists the editor's working copy; resolves to the dropped champion ids. */
  onSavePool: (pool: PoolConfig) => Promise<number[]>;
  /** Pool editor open state, owned by the screen (the Edit pool button lives there). */
  editorOpen: boolean;
  onEditorOpenChange: (open: boolean) => void;
  /** Called after a repo-file export so the difference banner refreshes. */
  onPoolChanged?: () => void;
}

/** Both recommendation lists, the empty-pool CTA, the hide toggle and the pool editor. */
export function PickRecommendations({
  role,
  poolIds,
  poolConfig,
  champions,
  iconVersion = null,
  profileLoad,
  baselineIndex,
  rankBucket,
  pickRate,
  pickRateSamples,
  userChampionId,
  recommendations,
  poolRecommendations,
  poolUnavailable,
  insufficientData,
  resetKey,
  repoFolder,
  onSavePool,
  editorOpen,
  onEditorOpenChange,
  onPoolChanged,
}: PickRecommendationsProps): ReactElement {
  const [hideMyPool, setHideMyPool] = useState(false);
  const [poolDropped, setPoolDropped] = useState<number[]>([]);

  const poolSet = useMemo(() => new Set(poolIds), [poolIds]);
  const removedRanks = useMemo(
    () => excludedRanks(userChampionId, recommendations, poolRecommendations),
    [userChampionId, recommendations, poolRecommendations],
  );
  const overallRecommendations = hidePoolChampions(
    excludePick(recommendations, userChampionId, removedRanks),
    poolSet,
    hideMyPool,
  );
  const visiblePoolRecommendations = excludePick(poolRecommendations, userChampionId, removedRanks);
  const poolUnavailableItems = useMemo(
    () => buildPoolUnavailableItems(poolUnavailable, insufficientData, userChampionId ?? undefined),
    [poolUnavailable, insufficientData, userChampionId],
  );
  // Thin-data fallback (BL-017, D-103): every champion below the baseline
  // gate renders as an unavailable card with the broader statistic after the
  // ranked entries. "Hide my pool" filters pool members here too.
  const overallUnavailable = useMemo(() => {
    const items = buildInsufficientItems(insufficientData, userChampionId ?? undefined);
    return hideMyPool ? items.filter((item) => !poolSet.has(item.championId)) : items;
  }, [insufficientData, userChampionId, hideMyPool, poolSet]);
  const cardContext = useMemo<RecommendationCardContext>(
    () => ({
      champions,
      iconVersion,
      profileLoad,
      role,
      baselineIndex,
      rankBucket,
      pickRate,
      pickRateSamples,
    }),
    [
      champions,
      iconVersion,
      profileLoad,
      role,
      baselineIndex,
      rankBucket,
      pickRate,
      pickRateSamples,
    ],
  );

  return (
    <>
      {poolIds.length > 0 && (
        <RecommendationsList
          title={strings.fromYourPool}
          recommendations={visiblePoolRecommendations}
          resetKey={resetKey}
          poolIds={poolSet}
          poolMembershipImplied
          unavailable={poolUnavailableItems}
          cardContext={cardContext}
        />
      )}

      {poolIds.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400">
          {strings.poolEmptyForRole(strings.roleNames[role])}{' '}
          <button
            type="button"
            onClick={() => onEditorOpenChange(true)}
            className="font-semibold text-indigo-600 underline underline-offset-4 hover:text-indigo-500 dark:text-indigo-400"
          >
            {strings.editPoolCta}
          </button>
        </div>
      )}

      {poolDropped.length > 0 && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-200"
        >
          {strings.poolDroppedNotice}{' '}
          {poolDropped.map((id) => championName(champions, id)).join(', ')}
        </p>
      )}

      <div className="flex items-center justify-end">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 select-none dark:text-slate-400">
          <input
            type="checkbox"
            checked={hideMyPool}
            onChange={(event) => setHideMyPool(event.target.checked)}
            className="h-4 w-4"
          />
          {strings.hideMyPool}
        </label>
      </div>

      <RecommendationsList
        title={strings.bestOverall}
        recommendations={overallRecommendations}
        resetKey={resetKey}
        poolIds={poolSet}
        unavailable={overallUnavailable}
        cardContext={cardContext}
      />

      <PoolEditor
        open={editorOpen}
        onClose={() => onEditorOpenChange(false)}
        pool={poolConfig}
        champions={champions}
        iconVersion={iconVersion}
        repoFolder={repoFolder}
        onSave={async (next) => {
          setPoolDropped(await onSavePool(next));
        }}
        onPoolChanged={onPoolChanged}
      />
    </>
  );
}
