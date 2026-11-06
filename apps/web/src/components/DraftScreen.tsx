/**
 * @draftorb/web — Draft screen (T-031/T-032/T-033).
 *
 * Ten draft slots (user, four allies, five enemies), each with a searchable
 * champion picker and an optional role. A blind-pick toggle and a rank
 * selector (Diamond default) complete the draft input. Any subset of inputs
 * is valid. The built `DraftInput` (including the personal pool) is scored by
 * the engine and rendered as a paginated "Best overall" list plus a
 * "From your pool" list (T-032/T-033).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type Champion,
  type ChampionPool,
  type DraftInput,
  type InsufficientDataEntry,
  type PoolUnavailableEntry,
  type ProfileExport,
  type Rank,
  rankSchema,
  type RecommendData,
  type Recommendation,
  type Role,
} from '@draftorb/shared';
import { recommend } from '@draftorb/engine';
import {
  loadChampionTags,
  loadChampions,
  loadExportFiles,
  loadLatest,
  loadManifest,
} from '../data/loader.js';
import { loadChampionIconVersion } from '../data/champion-icons.js';
import { loadProfile } from '../data/profile.js';
import { createRecommendData } from '../data/recommend-data.js';
import { excludePick, excludedRanks } from '../data/exclude-pick.js';
import { computePersonalizedEntries } from '../personalized.js';
import { championsForSlot } from '../champion-availability.js';
import { recommendationPageSize } from '../config.js';
import { strings } from '../strings.js';
import { DraftSlot, type DraftSlotState } from './DraftSlot.js';
import { RecommendationsList } from './RecommendationsList.js';
import { PersonalizedList } from './PersonalizedList.js';
import { PoolEditor } from './PoolEditor.js';
import { filterPoolByCatalogue, readPool, savePool } from '../pool/storage.js';
import {
  applyFavoritesMode,
  FAVORITES_MODES,
  importFavoritesIntoPool,
  type FavoritesMode,
} from '../pool/favorites.js';
import { buildPoolUnavailableItems } from '../pool/unavailable.js';

const USER_ROLE: Role = 'SUPPORT';
const DEFAULT_RANK: Rank = 'DIAMOND';
const ALLY_COUNT = 4;
const ENEMY_COUNT = 5;

function emptySlot(role?: Role): DraftSlotState {
  return { championId: null, role };
}

function isFilled(slot: DraftSlotState): slot is { championId: number; role?: Role } {
  return slot.championId != null;
}

export function DraftScreen() {
  const [patch, setPatch] = useState<string | null>(null);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [iconVersion, setIconVersion] = useState<string | null>(null);
  const [data, setData] = useState<RecommendData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [pool, setPool] = useState<ChampionPool | null>(null);
  const [profile, setProfile] = useState<ProfileExport | null>(null);
  const [poolStorageIssue, setPoolStorageIssue] = useState<'corrupt' | 'unavailable' | null>(null);
  const [poolDropped, setPoolDropped] = useState<number[]>([]);
  const [user, setUser] = useState<DraftSlotState>({ championId: null });
  const [allies, setAllies] = useState<DraftSlotState[]>(
    Array.from({ length: ALLY_COUNT }, () => emptySlot()),
  );
  const [enemies, setEnemies] = useState<DraftSlotState[]>(
    Array.from({ length: ENEMY_COUNT }, () => emptySlot()),
  );
  const [blindPick, setBlindPick] = useState(false);
  const [userRank, setUserRank] = useState<Rank>(DEFAULT_RANK);
  const [poolEditorOpen, setPoolEditorOpen] = useState(false);
  const [hideMyPool, setHideMyPool] = useState(false);
  const [favoritesMode, setFavoritesMode] = useState<FavoritesMode>('include');
  const [favoritesNotice, setFavoritesNotice] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [poolRecommendations, setPoolRecommendations] = useState<Recommendation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await loadLatest();
        void loadChampionIconVersion(latest.patch)
          .then((version) => {
            if (!cancelled) {
              setIconVersion(version);
            }
          })
          .catch(() => {});
        const manifest = await loadManifest(latest.manifest);
        if (manifest.patch !== latest.patch) {
          throw new Error(
            `Latest pointer patch ${latest.patch} does not match manifest patch ${manifest.patch}`,
          );
        }
        const loadedChampions = await loadChampions(latest.patch);
        const [loadedFiles, tags, loadedProfile] = await Promise.all([
          loadExportFiles(manifest),
          loadChampionTags(),
          loadProfile(),
        ]);
        const loadedPool = readPool();
        if (cancelled) {
          return;
        }
        setPatch(latest.patch);
        setChampions(loadedChampions);
        setProfile(loadedProfile);
        setData(createRecommendData(loadedFiles.files, loadedChampions, tags));
        const { pool: filteredPool, dropped } = filterPoolByCatalogue(
          loadedPool.pool ?? { version: 1, pools: {} },
          loadedChampions.map((champion) => champion.id),
        );
        setPool(filteredPool);
        setPoolStorageIssue(loadedPool.issue);
        setPoolDropped(dropped);
        if (dropped.length > 0 && !savePool(filteredPool)) {
          setPoolStorageIssue('unavailable');
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const poolChampionIds = useMemo(() => pool?.pools[USER_ROLE] ?? [], [pool]);
  const poolSet = useMemo(() => new Set(poolChampionIds), [poolChampionIds]);
  const favoriteIds = useMemo(() => new Set(profile?.favorites.combined ?? []), [profile]);

  const draftInput: DraftInput = useMemo(
    () => ({
      userRank,
      userRole: USER_ROLE,
      allies: allies.filter(isFilled).map((slot) => ({
        championId: slot.championId,
        role: slot.role,
      })),
      enemies: enemies.filter(isFilled).map((slot) => ({
        championId: slot.championId,
        role: slot.role,
      })),
      blindPick,
      pool: poolChampionIds,
    }),
    [userRank, allies, enemies, blindPick, poolChampionIds],
  );

  useEffect(() => {
    if (data === null) {
      return;
    }
    let cancelled = false;
    try {
      const result = recommend(draftInput, data);
      if (!cancelled) {
        setRecommendations(result.recommendations);
        setPoolRecommendations(result.poolRecommendations ?? []);
        setPoolUnavailable(result.poolUnavailable ?? []);
        setInsufficientData(result.insufficientData);
        setRecommendationError(null);
      }
    } catch (err) {
      if (!cancelled) {
        setRecommendations([]);
        setPoolRecommendations([]);
        setPoolUnavailable([]);
        setInsufficientData([]);
        setRecommendationError(err instanceof Error ? err.message : String(err));
      }
    }
    return () => {
      cancelled = true;
    };
  }, [draftInput, data]);

  const [poolUnavailable, setPoolUnavailable] = useState<PoolUnavailableEntry[]>([]);
  const [insufficientData, setInsufficientData] = useState<InsufficientDataEntry[]>([]);

  const setUserSlot = useCallback((slot: DraftSlotState) => setUser(slot), []);
  const setAlly = useCallback((index: number, slot: DraftSlotState) => {
    setAllies((current) => {
      const next = [...current];
      next[index] = slot;
      return next;
    });
  }, []);
  const setEnemy = useCallback((index: number, slot: DraftSlotState) => {
    setEnemies((current) => {
      const next = [...current];
      next[index] = slot;
      return next;
    });
  }, []);

  // A champion picked in one slot cannot be picked again in another.
  const usedChampionIds = useMemo(
    () => new Set([user, ...allies, ...enemies].filter(isFilled).map((slot) => slot.championId)),
    [user, allies, enemies],
  );

  const totalKnown = [user, ...allies, ...enemies].filter(isFilled).length;
  const poolSize = poolChampionIds.length;
  // The user's own pick is already taken: never suggest it again, and close
  // the rank gaps it leaves in both lists.
  const removedRanks = useMemo(
    () => excludedRanks(user.championId, recommendations, poolRecommendations),
    [user.championId, recommendations, poolRecommendations],
  );
  const overallRecommendations = applyFavoritesMode(
    excludePick(recommendations, user.championId, removedRanks).filter(
      (r) => !hideMyPool || !poolSet.has(r.championId),
    ),
    favoritesMode,
    favoriteIds,
  );
  const visiblePoolRecommendations = applyFavoritesMode(
    excludePick(poolRecommendations, user.championId, removedRanks),
    favoritesMode,
    favoriteIds,
  );

  // Personalized list (T-096): engine output for the configured profile.
  // `score(c)` and the other lists are untouched (D-072 invariant).
  const personalizedEntries = useMemo(() => {
    if (profile === null || data === null || recommendations.length === 0) {
      return [];
    }
    return computePersonalizedEntries(
      recommendations,
      profile,
      draftInput,
      data,
      user.championId,
      removedRanks,
      Date.now(),
    );
  }, [recommendations, profile, data, draftInput, user.championId, removedRanks]);
  const visiblePersonalized = applyFavoritesMode(personalizedEntries, favoritesMode, favoriteIds);
  const personalizedResetKey = useMemo(
    () => ({ draft: draftInput, profileId: profile?.id ?? null }),
    [draftInput, profile],
  );

  const importFavorites = useCallback(() => {
    if (profile === null) {
      return;
    }
    const result = importFavoritesIntoPool(pool, profile.favorites.combined);
    const { pool: filteredPool, dropped } = filterPoolByCatalogue(
      result.pool,
      champions.map((champion) => champion.id),
    );
    setPool(filteredPool);
    setPoolDropped(dropped);
    setPoolStorageIssue(savePool(filteredPool) ? null : 'unavailable');
    setFavoritesNotice(
      result.added.length === 0 && result.skipped === 0
        ? strings.favoritesNoNew
        : strings.favoritesImported(result.added.length, result.skipped),
    );
  }, [profile, pool, champions]);
  const poolUnavailableItems = useMemo(
    () =>
      applyFavoritesMode(
        buildPoolUnavailableItems(poolUnavailable, insufficientData, user.championId ?? undefined),
        favoritesMode,
        favoriteIds,
      ),
    [poolUnavailable, insufficientData, user.championId, favoritesMode, favoriteIds],
  );

  if (error) {
    return (
      <div className="p-6 text-center text-red-400">
        <h1 className="text-xl font-bold">{strings.appTitle}</h1>
        <p>{strings.loadFailed(error)}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-indigo-400">{strings.appTitle}</h1>
              {patch === null ? (
                <p className="text-sm text-gray-400">{strings.loading}</p>
              ) : (
                <p className="text-sm text-gray-400">
                  {strings.patchLabel}: <span className="font-mono text-indigo-300">{patch}</span>
                  {' · '}
                  {strings.championsLabel}: {champions.length}
                  {' · '}
                  {strings.poolLabel}: {poolSize}
                </p>
              )}
              {profile !== null && (
                <p className="text-sm text-emerald-300/90">
                  {strings.profileLabel(
                    profile.label,
                    `${profile.riotId.gameName}#${profile.riotId.tagLine}`,
                    profile.riotId.platform,
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">{strings.blindPick}</label>
                <button
                  role="switch"
                  aria-checked={blindPick}
                  onClick={() => setBlindPick((current) => !current)}
                  className={`relative inline-block w-10 h-6 rounded-full transition-colors ${blindPick ? 'bg-indigo-500' : 'bg-gray-700'}`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full ${blindPick ? 'translate-x-4' : 'translate-x-0'} bg-white`}
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">{strings.rank}</label>
                <select
                  value={userRank}
                  onChange={(event) => setUserRank(event.target.value as Rank)}
                  className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-400"
                >
                  {rankSchema.options.map((rank) => (
                    <option key={rank} value={rank}>
                      {rank.replace('_', '+')}
                    </option>
                  ))}
                </select>
              </div>
              {profile !== null && (
                <button
                  type="button"
                  onClick={importFavorites}
                  className="px-3 py-1.5 text-sm bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200 rounded border border-emerald-700/50"
                >
                  {strings.importFavorites}
                </button>
              )}
              <button
                type="button"
                onClick={() => setPoolEditorOpen(true)}
                className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 text-gray-200 rounded border border-gray-600"
              >
                {strings.editPool}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          <section className="flex-1">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              {strings.yourTeam}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <DraftSlot
                label={strings.userSlot}
                slot={user}
                onChange={setUserSlot}
                champions={championsForSlot(champions, usedChampionIds, user.championId)}
                showRole={false}
              />
              {allies.map((slot, index) => (
                <DraftSlot
                  key={index}
                  label={strings.allySlot(index + 1)}
                  slot={slot}
                  onChange={(next) => setAlly(index, next)}
                  champions={championsForSlot(champions, usedChampionIds, slot.championId)}
                />
              ))}
            </div>
          </section>

          <section className="flex-1">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              {strings.enemyTeam}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {enemies.map((slot, index) => (
                <DraftSlot
                  key={index}
                  label={strings.enemySlot(index + 1)}
                  slot={slot}
                  onChange={(next) => setEnemy(index, next)}
                  champions={championsForSlot(champions, usedChampionIds, slot.championId)}
                />
              ))}
            </div>
          </section>
        </div>

        {poolSize > 0 && (
          <div className="mb-4">
            <RecommendationsList
              title={strings.fromYourPool}
              recommendations={visiblePoolRecommendations}
              champions={champions}
              pageSize={recommendationPageSize}
              resetKey={draftInput}
              poolIds={poolSet}
              favoriteIds={favoritesMode === 'include' ? favoriteIds : undefined}
              unavailable={poolUnavailableItems}
            />
          </div>
        )}

        {profile !== null && visiblePersonalized.length > 0 && (
          <div className="mb-4">
            <PersonalizedList
              title={profile.label}
              entries={visiblePersonalized}
              champions={champions}
              pageSize={recommendationPageSize}
              resetKey={personalizedResetKey}
            />
          </div>
        )}

        {poolStorageIssue !== null && (
          <div
            role="status"
            className="mb-4 p-3 rounded bg-amber-900/20 border border-amber-600/30 text-sm text-amber-300"
          >
            {poolStorageIssue === 'corrupt' ? strings.corruptPool : strings.unavailableStorage}
          </div>
        )}
        {poolDropped.length > 0 && (
          <div
            role="status"
            className="mb-4 p-3 rounded bg-amber-900/20 border border-amber-600/30 text-xs text-amber-300"
          >
            {strings.poolDropped} {poolDropped.map((id) => `Champion ${id}`).join(', ')}
          </div>
        )}

        {poolSize === 0 && (
          <div className="mb-4 p-4 rounded bg-gray-800/30 border border-gray-800 text-center text-sm text-gray-400">
            {strings.poolEmpty}{' '}
            <button
              type="button"
              onClick={() => setPoolEditorOpen(true)}
              className="underline underline-offset-4 hover:text-indigo-300"
            >
              {strings.editPoolCta}
            </button>{' '}
            {strings.personalizedPool}
          </div>
        )}

        {favoritesNotice !== null && (
          <div
            role="status"
            className="mb-4 p-3 rounded bg-emerald-900/20 border border-emerald-600/30 text-sm text-emerald-300"
          >
            {favoritesNotice}
          </div>
        )}

        <div className="flex items-center justify-end gap-4 mb-2">
          {profile !== null && (
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              {strings.favoritesModeLabel}
              <select
                value={favoritesMode}
                onChange={(event) => setFavoritesMode(event.target.value as FavoritesMode)}
                className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-400"
              >
                {FAVORITES_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {strings.favoritesModeOption(mode)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideMyPool}
              onChange={(event) => setHideMyPool(event.target.checked)}
            />
            {strings.hideMyPool}
          </label>
        </div>
        <RecommendationsList
          title={strings.bestOverall}
          recommendations={overallRecommendations}
          champions={champions}
          pageSize={recommendationPageSize}
          resetKey={draftInput}
          poolIds={poolSet}
          favoriteIds={favoritesMode === 'include' ? favoriteIds : undefined}
        />
        {recommendationError !== null && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {strings.recommendationFailed(recommendationError)}
          </p>
        )}

        <p className="mt-4 text-xs text-gray-500 text-center">{strings.slotsFilled(totalKnown)}</p>
      </main>

      <PoolEditor
        open={poolEditorOpen}
        onClose={() => setPoolEditorOpen(false)}
        pool={pool}
        champions={champions}
        iconVersion={iconVersion}
        onSave={(nextPool) => {
          const { pool: filteredPool, dropped } = filterPoolByCatalogue(
            nextPool,
            champions.map((champion) => champion.id),
          );
          setPool(filteredPool);
          setPoolDropped(dropped);
          setPoolStorageIssue(savePool(filteredPool) ? null : 'unavailable');
          setPoolEditorOpen(false);
        }}
      />
    </div>
  );
}
