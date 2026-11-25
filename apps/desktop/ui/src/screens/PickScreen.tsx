/**
 * Pick screen (BL-009, v1a SUPPORT-only): draft slots for the user's pick,
 * four allies and five enemies, and a rank selector.
 * The engine's `recommend` output renders as "From your pool" above
 * "Best overall" (D-024 invariants, 5-per-page "Show more").
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { recommend } from '@draftorb/engine';
import {
  type Champion,
  type DraftInput,
  type InsufficientDataEntry,
  type PoolUnavailableEntry,
  type Rank,
  type Recommendation,
  rankSchema,
  type Role,
} from '@draftorb/shared';
import type { ProfileLoad } from '../profile/profile-export';
import { loadPool } from '../pool/pool-store';
import { loadPickData, type PickData } from '../data/export-data';
import { loadChampionIconVersion } from '../data/champion-icons';
import { championsForSlot } from '../pick/champion-availability';
import { excludePick, excludedRanks } from '../pick/exclude-pick';
import { buildPoolUnavailableItems } from '../pick/pool-unavailable';
import { DraftSlot, type DraftSlotState } from '../components/DraftSlot';
import { RecommendationsList } from '../components/RecommendationsList';
import { strings } from '../strings';

const DEFAULT_RANK: Rank = 'DIAMOND';
const ALLY_COUNT = 4;
const ENEMY_COUNT = 5;

function emptySlot(): DraftSlotState {
  return { championId: null };
}

function isFilled(slot: DraftSlotState): slot is { championId: number; role?: Role } {
  return slot.championId != null;
}

type SlotSetter = Dispatch<SetStateAction<DraftSlotState[]>>;

export interface PickScreenProps {
  role: Role;
  profileLoad: ProfileLoad;
  /** Bumped each time the launch data download settles; triggers a cache reload. */
  dataReadyNonce: number;
}

export function PickScreen({ role, profileLoad, dataReadyNonce }: PickScreenProps) {
  const [pickData, setPickData] = useState<PickData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [iconVersion, setIconVersion] = useState<string | null>(null);
  const [poolIds, setPoolIds] = useState<number[]>([]);
  const [user, setUser] = useState<DraftSlotState>({ championId: null });
  const [allies, setAllies] = useState<DraftSlotState[]>(
    Array.from({ length: ALLY_COUNT }, emptySlot),
  );
  const [enemies, setEnemies] = useState<DraftSlotState[]>(
    Array.from({ length: ENEMY_COUNT }, emptySlot),
  );
  const [userRank, setUserRank] = useState<Rank>(DEFAULT_RANK);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [poolRecommendations, setPoolRecommendations] = useState<Recommendation[]>([]);
  const [poolUnavailable, setPoolUnavailable] = useState<PoolUnavailableEntry[]>([]);
  const [insufficientData, setInsufficientData] = useState<InsufficientDataEntry[]>([]);
  const [recommendError, setRecommendError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadPickData(role);
        if (cancelled) return;
        if (loaded === null) {
          setLoadError(strings.pickNoData);
          return;
        }
        setPickData(loaded);
        void loadChampionIconVersion(loaded.patch)
          .then((version) => {
            if (!cancelled) setIconVersion(version);
          })
          .catch(() => {});
        const { pool } = await loadPool();
        if (cancelled) return;
        setPoolIds((pool.pools[role] ?? []).map((entry) => entry.championId));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, dataReadyNonce]);

  const champions: Champion[] = useMemo(() => pickData?.champions ?? [], [pickData]);
  const poolSet = useMemo(() => new Set(poolIds), [poolIds]);

  const draftInput: DraftInput = useMemo(
    () => ({
      userRank,
      userRole: role,
      allies: allies.filter(isFilled).map((slot) => ({
        championId: slot.championId,
        role: slot.role,
      })),
      enemies: enemies.filter(isFilled).map((slot) => ({
        championId: slot.championId,
        role: slot.role,
      })),
      // No manual toggle: the engine applies blind safety whenever a lane-group
      // enemy role is unknown (SPECS §5); a forced flag cannot change output.
      blindPick: false,
      pool: poolIds,
    }),
    [userRank, role, allies, enemies, poolIds],
  );

  useEffect(() => {
    if (pickData === null) return;
    try {
      const result = recommend(draftInput, pickData.data);
      setRecommendations(result.recommendations);
      setPoolRecommendations(result.poolRecommendations ?? []);
      setPoolUnavailable(result.poolUnavailable ?? []);
      setInsufficientData(result.insufficientData);
      setRecommendError(null);
    } catch (err) {
      setRecommendations([]);
      setPoolRecommendations([]);
      setPoolUnavailable([]);
      setInsufficientData([]);
      setRecommendError(err instanceof Error ? err.message : String(err));
    }
  }, [draftInput, pickData]);

  const slotUpdater = (setter: SlotSetter) => (index: number, slot: DraftSlotState) =>
    setter((current) => current.map((entry, i) => (i === index ? slot : entry)));
  const setAlly = slotUpdater(setAllies);
  const setEnemy = slotUpdater(setEnemies);

  const usedChampionIds = useMemo(
    () => new Set([user, ...allies, ...enemies].filter(isFilled).map((slot) => slot.championId)),
    [user, allies, enemies],
  );

  const removedRanks = useMemo(
    () => excludedRanks(user.championId, recommendations, poolRecommendations),
    [user.championId, recommendations, poolRecommendations],
  );
  const overallRecommendations = excludePick(recommendations, user.championId, removedRanks);
  const visiblePoolRecommendations = excludePick(
    poolRecommendations,
    user.championId,
    removedRanks,
  );
  const poolUnavailableItems = useMemo(
    () =>
      buildPoolUnavailableItems(poolUnavailable, insufficientData, user.championId ?? undefined),
    [poolUnavailable, insufficientData, user.championId],
  );

  if (loadError !== null) {
    return <p className="text-red-600 dark:text-red-400">{strings.loadFailed(loadError)}</p>;
  }
  if (pickData === null) {
    return <p className="text-slate-500 dark:text-slate-400">{strings.loading}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          {strings.rankLabel}
          <select
            value={userRank}
            onChange={(event) => setUserRank(event.target.value as Rank)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            {rankSchema.options.map((rank) => (
              <option key={rank} value={rank}>
                {rank}
              </option>
            ))}
          </select>
        </label>
      </div>

      {recommendError !== null && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {strings.loadFailed(recommendError)}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {strings.yourTeam}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <DraftSlot
              label={strings.userSlot}
              slot={user}
              onChange={setUser}
              champions={championsForSlot(champions, usedChampionIds, user.championId)}
              showRole={false}
              iconVersion={iconVersion}
            />
            {allies.map((slot, index) => (
              <DraftSlot
                key={`ally-${index}`}
                label={strings.allySlot(index + 1)}
                slot={slot}
                onChange={(next) => setAlly(index, next)}
                champions={championsForSlot(champions, usedChampionIds, slot.championId)}
                iconVersion={iconVersion}
              />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {strings.enemyTeam}
          </h2>
          <div className="grid grid-cols-2 gap-4">
            {enemies.map((slot, index) => (
              <DraftSlot
                key={`enemy-${index}`}
                label={strings.enemySlot(index + 1)}
                slot={slot}
                onChange={(next) => setEnemy(index, next)}
                champions={championsForSlot(champions, usedChampionIds, slot.championId)}
                iconVersion={iconVersion}
              />
            ))}
          </div>
        </section>
      </div>

      {poolIds.length > 0 && (
        <RecommendationsList
          title={strings.fromYourPool}
          recommendations={visiblePoolRecommendations}
          champions={champions}
          resetKey={draftInput}
          poolIds={poolSet}
          unavailable={poolUnavailableItems}
          iconVersion={iconVersion}
          profileLoad={profileLoad}
          role={role}
        />
      )}

      <RecommendationsList
        title={strings.bestOverall}
        recommendations={overallRecommendations}
        champions={champions}
        resetKey={draftInput}
        poolIds={poolSet}
        iconVersion={iconVersion}
        profileLoad={profileLoad}
        role={role}
      />
    </div>
  );
}
