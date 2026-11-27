/**
 * Pick screen (BL-009/BL-024): draft slots for the user's pick,
 * four allies and five enemies, and a rank selector.
 * The engine's `recommend` output renders as "From your pool" above
 * "Best overall" (D-024 invariants, 5-per-page "Show more").
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { indexBaselines, rankToBucket, recommend } from '@draftorb/engine';
import {
  type Champion,
  type ChampionId,
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
import {
  loadChampionCatalog,
  loadPickData,
  type ChampionCatalog,
  type PickData,
} from '../data/export-data';
import { championName } from '../champion-name';
import { loadChampionIconVersion } from '../data/champion-icons';
import { championsForSlot } from '../pick/champion-availability';
import { enemyRoleViews } from '../pick/enemy-roles';
import {
  addBan,
  isPickTargetIndex,
  nextEmptyTarget,
  PICK_TARGETS,
  removeBan,
} from '../pick/draft-entry';
import { DraftSlot, type DraftSlotState } from '../components/DraftSlot';
import { DraftEntryBar, type EntryTargetInfo } from '../components/DraftEntryBar';
import { PickRecommendations } from '../components/PickRecommendations';
import { PoolEditor } from '../components/PoolEditor';
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
  /** D-126 empty verdict: skip recommendation data, keep the pool editor. */
  noEligibleRole?: boolean;
}

export function PickScreen({
  role,
  profileLoad,
  dataReadyNonce,
  repoFolder,
  onPoolChanged,
  noEligibleRole = false,
}: PickScreenProps) {
  const [pickData, setPickData] = useState<PickData | null>(null);
  const [catalog, setCatalog] = useState<ChampionCatalog | null>(null);
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
  const [bans, setBans] = useState<ChampionId[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [poolRecommendations, setPoolRecommendations] = useState<Recommendation[]>([]);
  const [poolUnavailable, setPoolUnavailable] = useState<PoolUnavailableEntry[]>([]);
  const [insufficientData, setInsufficientData] = useState<InsufficientDataEntry[]>([]);
  const [recommendError, setRecommendError] = useState<string | null>(null);
  const [poolDropped, setPoolDropped] = useState<number[]>([]);

  useEffect(() => {
    if (noEligibleRole) {
      setPickData(null);
      setLoadError(null);
      return;
    }
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
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, dataReadyNonce, noEligibleRole]);

  // Champion catalog for the pool editor: role-independent, so it stays
  // usable when no role is eligible or pick data fails to load (BL-050).
  useEffect(() => {
    let cancelled = false;
    void loadChampionCatalog()
      .then((loaded) => {
        if (cancelled || loaded === null) return;
        setCatalog(loaded);
        void loadChampionIconVersion(loaded.patch)
          .then((version) => {
            if (!cancelled) setIconVersion(version);
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataReadyNonce]);

  // The pool loads independently of aggregates so the editor (and its JSON
  // backup) stays usable when pick data is missing or fails to load.
  useEffect(() => {
    let cancelled = false;
    void loadPool()
      .then(({ pool }) => {
        if (cancelled) return;
        // Keep the same object when the content is unchanged so reloads
        // do not churn the pool editor or the lists.
        setPoolConfig((current) =>
          serializePoolConfig(current) === serializePoolConfig(pool) ? current : pool,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataReadyNonce]);

  // The catalog is the dedicated lightweight loader: prefer it so a stale
  // pickData from a previous patch cannot mask a newer champions.json.
  const champions: Champion[] = useMemo(
    () => catalog?.champions ?? pickData?.champions ?? [],
    [pickData, catalog],
  );
  // BL-051: per-bucket baseline index for the champion-average badge row;
  // rebuilt when the rank selector changes the bucket.
  const rankBucket = rankToBucket(userRank);
  const baselineIndex = useMemo(
    () => (pickData === null ? undefined : indexBaselines(pickData.data.baselines, rankBucket)),
    [pickData, rankBucket],
  );
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
      bans,
    }),
    [userRank, role, allies, enemies, poolIds, bans],
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

  // Banned champions are unavailable everywhere: slot pickers and the entry
  // bar search share this set (SPECS §2: banned ids leave the candidate set).
  const blockedChampionIds = useMemo(
    () => new Set<ChampionId>([...usedChampionIds, ...bans]),
    [usedChampionIds, bans],
  );

  // Entry-bar state (BL-022): filled pick targets in PICK_TARGETS order
  // (0 = you, 1-4 = allies, 5-9 = enemies) drive the auto-advance.
  const filledTargetIndexes = useMemo(() => {
    const filled = new Set<number>();
    if (user.championId !== null) filled.add(0);
    allies.forEach((slot, index) => {
      if (slot.championId !== null) filled.add(1 + index);
    });
    enemies.forEach((slot, index) => {
      if (slot.championId !== null) filled.add(5 + index);
    });
    return filled;
  }, [user, allies, enemies]);

  const slotAtTarget = (targetIndex: number): DraftSlotState | undefined => {
    const target = PICK_TARGETS[targetIndex];
    if (target === undefined) return undefined;
    if (target.kind === 'user') return user;
    if (target.kind === 'ally') return allies[target.index];
    return enemies[target.index];
  };

  const applyEntryPick = (targetIndex: number, championId: ChampionId) => {
    const target = PICK_TARGETS[targetIndex];
    if (target === undefined) return;
    const assign = (slot: DraftSlotState): DraftSlotState => ({
      ...slot,
      championId,
      role: slot.championId === championId ? slot.role : undefined,
    });
    if (target.kind === 'user') {
      setUser(assign(user));
    } else if (target.kind === 'ally') {
      setAllies((current) => current.map((s, i) => (i === target.index ? assign(s) : s)));
    } else {
      setEnemies((current) => current.map((s, i) => (i === target.index ? assign(s) : s)));
    }
    const filledAfter = new Set(filledTargetIndexes);
    filledAfter.add(targetIndex);
    setActiveIndex(nextEmptyTarget(filledAfter, targetIndex));
  };

  const applyEntryRole = (targetIndex: number, role: Role | undefined) => {
    const target = PICK_TARGETS[targetIndex];
    if (target?.kind === 'ally') {
      setAllies((current) => current.map((s, i) => (i === target.index ? { ...s, role } : s)));
    } else if (target?.kind === 'enemy') {
      setEnemies((current) => current.map((s, i) => (i === target.index ? { ...s, role } : s)));
    }
  };

  const activeTarget = isPickTargetIndex(activeIndex) ? PICK_TARGETS[activeIndex] : undefined;
  const activeSlot = activeTarget === undefined ? undefined : slotAtTarget(activeIndex);
  const activeSlotFilled = activeSlot?.championId != null;
  const roleEditable =
    activeTarget !== undefined && activeTarget.kind !== 'user' && activeSlotFilled;

  const nameById = useMemo(
    () => new Map(champions.map((champion) => [champion.id, champion.name])),
    [champions],
  );
  const championNameOf = (id: ChampionId | null): string | null =>
    id === null ? null : (nameById.get(id) ?? strings.championFallback(id));
  const entryTargets: EntryTargetInfo[] = PICK_TARGETS.map((target, index) => {
    const slot = slotAtTarget(index);
    const label =
      target.kind === 'user'
        ? strings.userSlot
        : target.kind === 'ally'
          ? strings.allySlot(target.index + 1)
          : strings.enemySlot(target.index + 1);
    return {
      key: target.kind === 'user' ? 'user' : `${target.kind}-${target.index}`,
      label,
      championName: championNameOf(slot?.championId ?? null),
    };
  });

  /** Persists the editor's working copy; resolves to the dropped champion ids. */
  const persistPool = async (next: PoolConfig): Promise<number[]> => {
    // Without a champion catalog every id would look unknown: never drop then.
    if (champions.length === 0) {
      await savePool(next);
      setPoolConfig(next);
      onPoolChanged?.();
      return [];
    }
    const knownIds = new Set(champions.map((champion) => champion.id));
    const { pool: filtered, dropped } = dropUnknownChampions(next, knownIds);
    await savePool(filtered);
    setPoolConfig(filtered);
    onPoolChanged?.();
    return dropped;
  };

  if (noEligibleRole || loadError !== null || pickData === null) {
    return (
      <div className="space-y-4">
        {noEligibleRole ? (
          <p role="status" className="text-slate-600 dark:text-slate-300">
            {strings.noEligibleRole}
          </p>
        ) : loadError !== null ? (
          <p className="text-red-600 dark:text-red-400">{strings.loadFailed(loadError)}</p>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">{strings.loading}</p>
        )}
        <button
          type="button"
          onClick={() => setPoolEditorOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {strings.editPool}
        </button>
        <PoolEditor
          open={poolEditorOpen}
          onClose={() => setPoolEditorOpen(false)}
          pool={poolConfig}
          champions={champions}
          iconVersion={iconVersion}
          repoFolder={repoFolder}
          onSave={async (next) => {
            setPoolDropped(await persistPool(next));
          }}
          onPoolChanged={onPoolChanged}
        />
        {poolDropped.length > 0 && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-200"
          >
            {strings.poolDroppedNotice}{' '}
            {poolDropped.map((id) => championName(champions, id)).join(', ')}
          </p>
        )}
      </div>
    );
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

      {pickData.minimal && (
        <p className="text-xs text-slate-500 dark:text-slate-400">{strings.pickMinimalNote}</p>
      )}

      {recommendError !== null && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {strings.loadFailed(recommendError)}
        </p>
      )}

      <DraftEntryBar
        champions={champions}
        iconVersion={iconVersion}
        targets={entryTargets}
        activeIndex={activeIndex}
        onActiveIndex={setActiveIndex}
        bans={bans}
        excludedIds={blockedChampionIds}
        activeRole={roleEditable ? activeSlot?.role : undefined}
        roleEditable={roleEditable}
        onPick={applyEntryPick}
        onSetRole={applyEntryRole}
        onAddBan={(championId) =>
          setBans((current) => addBan(current, championId, usedChampionIds) ?? current)
        }
        onRemoveBan={(championId) => setBans((current) => removeBan(current, championId))}
      />

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
              champions={championsForSlot(champions, blockedChampionIds, user.championId)}
              showRole={false}
              iconVersion={iconVersion}
            />
            {allies.map((slot, index) => (
              <DraftSlot
                key={`ally-${index}`}
                label={strings.allySlot(index + 1)}
                slot={slot}
                onChange={(next) => setAlly(index, next)}
                champions={championsForSlot(champions, blockedChampionIds, slot.championId)}
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
                champions={championsForSlot(champions, blockedChampionIds, slot.championId)}
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
        baselineIndex={baselineIndex}
        rankBucket={rankBucket}
        pickRate={pickData.data.pickRate}
        pickRateSamples={pickData.pickRateSamples}
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
