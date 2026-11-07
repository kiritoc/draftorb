/**
 * @draftorb/web — Personalized recommendations list (T-096, D-072, SPECS §18.3).
 *
 * Renders the engine's `PersonalizeResult` entries for the configured
 * profile: same 5-by-5 "Show more" pagination and reset behavior as the
 * other lists, profile-WR / n_eff / fallback-level / +d-vs-meta badges,
 * and an insufficient-data state that shows the sample size instead of a
 * percentage (D-075). Only rendered when a profile export is loaded.
 */

import { useEffect, useMemo, useReducer } from 'react';

import type { Champion } from '@draftorb/shared';
import type { PersonalizedEntry } from '@draftorb/engine';
import { recommendationPageSize } from '../config.js';
import { paginate } from '../pagination.js';
import { pageCountReducer } from './RecommendationsList.js';
import { strings } from '../strings.js';

export interface PersonalizedListProps {
  /** List title — the configured profile label (never "For you", D-072). */
  title: string;
  entries: readonly PersonalizedEntry[];
  champions: Champion[];
  pageSize?: number;
  resetKey: unknown;
}

const FALLBACK_LEVEL_LABEL: Record<number, string> = {
  1: 'L1 · same ally + enemy support',
  2: 'L2 · same enemy support',
  3: 'L3 · similar enemy comp',
  4: 'L4 · champion overall (role)',
  5: 'L5 · champion overall',
};

function championName(champions: Champion[], id: number): string {
  return champions.find((c) => c.id === id)?.name ?? strings.championFallback(id);
}

function PersonalizedCard({
  entry,
  champions,
}: {
  entry: PersonalizedEntry;
  champions: Champion[];
}) {
  const name = championName(champions, entry.championId);
  const scorePct = (entry.personalizedScore * 100).toFixed(1);
  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-mono text-gray-500">#{entry.rank}</span>
          <h3 className="text-base font-bold text-gray-100">{name}</h3>
        </div>
        <span className="text-sm font-mono text-emerald-400">
          {scorePct}% {strings.win}
        </span>
      </div>
      {entry.insufficientData || entry.profileWinRate === null ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded border bg-gray-800 text-gray-400 border-gray-600/30">
            {strings.insufficientDataLabel}
          </span>
          <span className="text-gray-400">
            {strings.nEffLabel} {entry.nEff.toFixed(1)}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 text-xs">
          <span
            className="px-2 py-1 rounded border bg-emerald-900/40 text-emerald-300 border-emerald-600/30"
            title={FALLBACK_LEVEL_LABEL[entry.fallbackLevel ?? 0]}
          >
            {strings.personalizedBadge(
              Math.round(entry.profileWinRate * 100),
              Math.round(entry.nEff),
              entry.fallbackLevel ?? 0,
              entry.deltaVsMetaPp ?? 0,
            )}
          </span>
        </div>
      )}
    </div>
  );
}

export function PersonalizedList({
  title,
  entries,
  champions,
  pageSize = recommendationPageSize,
  resetKey,
}: PersonalizedListProps) {
  const pages = useMemo(() => paginate(entries, pageSize), [entries, pageSize]);
  const [pageCount, dispatch] = useReducer(pageCountReducer, 1);

  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [resetKey]);

  const visibleCount = Math.min(pageCount * pageSize, entries.length);
  const exhausted = visibleCount >= entries.length;

  return (
    <div className="border border-emerald-800/60 rounded-lg bg-gray-800/50">
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-sm font-bold text-emerald-300">{title}</h2>
      </div>
      {entries.length === 0 ? (
        <div className="p-6 text-center text-gray-500">{strings.recommendationEmpty}</div>
      ) : (
        <div className="p-4 space-y-3">
          {pages
            .slice(0, pageCount)
            .flat()
            .map((entry) => (
              <PersonalizedCard key={entry.championId} entry={entry} champions={champions} />
            ))}
        </div>
      )}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
        <span role="status" aria-live="polite" className="text-xs text-gray-400">
          {strings.showing(visibleCount, entries.length)}
        </span>
        {!exhausted && entries.length > 0 && (
          <button
            onClick={() => dispatch({ type: 'showMore', maxPages: pages.length })}
            disabled={exhausted}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-100 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 disabled:pointer-events-none"
          >
            {strings.showMore(Math.min(pageSize, entries.length - visibleCount))}
          </button>
        )}
      </div>
    </div>
  );
}
