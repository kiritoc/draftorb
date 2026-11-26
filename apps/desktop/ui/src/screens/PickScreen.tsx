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
  type PoolConfig,
  type PoolUnavailableEntry,
  type Rank,
  type Recommendation,
  rankSchema,
  type Role,
} from '@draftorb/shared';
import type { ProfileLoad } from '../profile/profile-export';
import { emptyPool, loadPool, savePool } from '../pool/pool-store';
import { dropUnknownChampions, serializePoolConfig } from '../pool/pool-model';
import { loadPickData, type PickData } from '../data/export-data';
import { loadChampionIconVersion } from '../data/champion-icons';
import { championsForSlot } from '../pick/champion-availability';
import { enemyRoleViews } from '../pick/enemy-roles';
import { DraftSlot, type DraftSlotState } from '../components/DraftSlot';
import { PickRecommendations } from '../components/PickRecommendations';
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
  /** Repo folder for the pool editor's repo-file actions (SPECS §19.3). */
  repoFolder?: string;
  /** Called after the pool is saved or exported to the repo file (D-118 banner). */
  onPoolChanged?: () => void;
}

export function PickScreen({
  role,
  profileLoad,
  dataReadyNonce,
  repoFolder,
  onPoolChanged,
}: PickScreenProps) {
  const [pickData, setPickData] = useState<PickData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [iconVersion, setIconVersion] = useState<string | null>(null);
  const [poolConfig, setPoolConfig] = useState<PoolConfig>(emptyPool());
  const [poolEditorOpen, setPoolEditorOpen] = useState(false);
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
        setLoadError(null);
        setPickData(loaded);
        void loadChampionIconVersion(loaded.patch)
          .then((version) => {
            if (!cancelled) setIconVersion(version);
          })
          .catch(() => {});
        const { pool } = await loadPool();
        if (cancelled) return;
        // Keep the same object when the content is unchanged so data refreshes
        // do not churn the pool editor or the lists.
        setPoolConfig((current) =>
          serializePoolConfig(current) === serializePoolConfig(pool) ? current : pool,
        );
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
  const poolIds = useMemo(
    () => (poolConfig.pools[role] ?? []).map((entry) => entry.championId),
    [poolConfig, role],
  );
  const enemyViews = useMemo(
    () => (pickData === null ? [] : enemyRoleViews(enemies, pickData.data.roleProb)),
    [enemies, pickData],
  );

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

  /** Persists the editor's working copy; resolves to the dropped champion ids. */
  const persistPool = async (next: PoolConfig): Promise<number[]> => {
    const knownIds = new Set(champions.map((champion) => champion.id));
    const { pool: filtered, dropped } = dropUnknownChampions(next, knownIds);
    await savePool(filtered);
    setPoolConfig(filtered);
    onPoolChanged?.();
    return dropped;
  };

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
        <button
          type="button"
          onClick={() => setPoolEditorOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {strings.editPool}
        </button>
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
                roleView={enemyViews[index] ?? null}
                iconVersion={iconVersion}
              />
            ))}
          </div>
        </section>
      </div>

      <PickRecommendations
        role={role}
        poolIds={poolIds}
        poolConfig={poolConfig}
        champions={champions}
        iconVersion={iconVersion}
        profileLoad={profileLoad}
        userChampionId={user.championId}
        recommendations={recommendations}
        poolRecommendations={poolRecommendations}
        poolUnavailable={poolUnavailable}
        insufficientData={insufficientData}
        resetKey={draftInput}
        repoFolder={repoFolder}
        onSavePool={persistPool}
        editorOpen={poolEditorOpen}
        onEditorOpenChange={setPoolEditorOpen}
        onPoolChanged={onPoolChanged}
      />
    </div>
  );
}
