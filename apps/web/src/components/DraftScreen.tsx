/**
 * @draftorb/web — Draft screen (T-031/T-032).
 *
 * Ten draft slots (user, four allies, five enemies), each with a searchable
 * champion picker and an optional role. A blind-pick toggle and a rank
 * selector (Diamond default) complete the draft input. Any subset of inputs
 * is valid. The built `DraftInput` is scored by the engine and rendered as a
 * paginated "Best overall" recommendations list (T-032).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type BaselineEntry,
  type Champion,
  type ChampionRoleProbabilities,
  type DraftInput,
  type Rank,
  type RecommendData,
  type Recommendation,
  type Role,
} from '@draftorb/shared';
import { recommend } from '@draftorb/engine';
import { loadChampions, loadExportFiles, loadLatest, loadManifest } from '../data/loader.js';
import { recommendationPageSize } from '../config.js';
import { DraftSlot, type DraftSlotState } from './DraftSlot.js';
import { RecommendationsList } from './RecommendationsList.js';

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
  const [files, setFiles] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<DraftSlotState>(emptySlot(USER_ROLE));
  const [allies, setAllies] = useState<DraftSlotState[]>(
    Array.from({ length: ALLY_COUNT }, () => emptySlot()),
  );
  const [enemies, setEnemies] = useState<DraftSlotState[]>(
    Array.from({ length: ENEMY_COUNT }, () => emptySlot()),
  );
  const [blindPick, setBlindPick] = useState(false);
  const [userRank, setUserRank] = useState<Rank>(DEFAULT_RANK);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const latest = await loadLatest();
        const [loadedChampions, loadedFiles] = await Promise.all([
          loadChampions(latest.patch),
          loadManifest(latest.patch).then((manifest) => loadExportFiles(manifest)),
        ]);
        if (cancelled) {
          return;
        }
        setPatch(latest.patch);
        setChampions(loadedChampions);
        setFiles(loadedFiles.files);
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

  const data: RecommendData = useMemo(
    () => ({
      baselines: (files['roles/SUPPORT/baseline.json'] as BaselineEntry[] | undefined) ?? [],
      allyPairs: [],
      enemyPairs: [],
      laneVs: [],
      laneFull: [],
      roleProb: (files['role-prob.json'] as ChampionRoleProbabilities | undefined) ?? {},
      tags: {},
      championIds: champions.map((champion) => champion.id),
    }),
    [files, champions],
  );

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
    }),
    [userRank, allies, enemies, blindPick],
  );

  useEffect(() => {
    let cancelled = false;
    try {
      const result = recommend(draftInput, data);
      if (!cancelled) {
        setRecommendations(result.recommendations);
      }
    } catch {
      if (!cancelled) {
        setRecommendations([]);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [draftInput, data]);

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

  const totalKnown = [user, ...allies, ...enemies].filter(isFilled).length;

  if (error) {
    return (
      <div className="p-6 text-center text-red-400">
        <h1 className="text-xl font-bold">DraftOrb</h1>
        <p>Failed to load data: {error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-indigo-400">DraftOrb</h1>
              {patch === null ? (
                <p className="text-sm text-gray-400">Loading data…</p>
              ) : (
                <p className="text-sm text-gray-400">
                  Patch: <span className="font-mono text-indigo-300">{patch}</span>
                  {' · '}
                  Champions: {champions.length}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">Blind pick</label>
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
                <label className="text-sm text-gray-400">Rank</label>
                <select
                  value={userRank}
                  onChange={(event) => setUserRank(event.target.value as Rank)}
                  className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-400"
                >
                  {[
                    'IRON',
                    'BRONZE',
                    'SILVER',
                    'GOLD',
                    'PLATINUM',
                    'EMERALD',
                    'DIAMOND',
                    'MASTER_PLUS',
                  ].map((rank) => (
                    <option key={rank} value={rank}>
                      {rank.replace('_', '+')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          <section className="flex-1">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Your team
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <DraftSlot
                label="You (SUPPORT)"
                slot={user}
                onChange={setUserSlot}
                champions={champions}
              />
              {allies.map((slot, index) => (
                <DraftSlot
                  key={index}
                  label={`Ally ${index + 1}`}
                  slot={slot}
                  onChange={(next) => setAlly(index, next)}
                  champions={champions}
                />
              ))}
            </div>
          </section>

          <section className="flex-1">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Enemy team
            </h2>
            <div className="grid grid-cols-2 gap-4">
              {enemies.map((slot, index) => (
                <DraftSlot
                  key={index}
                  label={`Enemy ${index + 1}`}
                  slot={slot}
                  onChange={(next) => setEnemy(index, next)}
                  champions={champions}
                />
              ))}
            </div>
          </section>
        </div>

        <RecommendationsList
          title="Best overall"
          recommendations={recommendations}
          champions={champions}
          pageSize={recommendationPageSize}
        />

        <p className="mt-4 text-xs text-gray-500 text-center">
          {totalKnown} of 10 slots filled &mdash; any subset of inputs is valid.
        </p>
      </main>
    </div>
  );
}
