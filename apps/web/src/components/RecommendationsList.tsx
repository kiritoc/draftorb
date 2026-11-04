/**
 * @draftorb/web — Paginated recommendations list ("Best overall").
 *
 * Always renders (even when empty). Pages through `recommendationPageSize`
 * items at a time with a "Show N more" button and a live "Showing X of Y"
 * count. The visible count resets when the recommendation list changes.
 */

import { useEffect, useMemo, useReducer } from 'react';

import { type Champion, type Recommendation } from '@draftorb/shared';
import { recommendationPageSize } from '../config.js';
import { paginate } from '../pagination.js';
import { RecommendationCard } from './RecommendationCard.js';
import { strings } from '../strings.js';

export type PaginationAction = { type: 'reset' } | { type: 'showMore'; maxPages: number };

export function pageCountReducer(pageCount: number, action: PaginationAction): number {
  if (action.type === 'reset') {
    return 1;
  }
  return Math.min(pageCount + 1, action.maxPages);
}

export interface RecommendationsListProps {
  title: string;
  recommendations: Recommendation[];
  champions: Champion[];
  pageSize?: number;
  resetKey: unknown;
}

export function RecommendationsList({
  title,
  recommendations,
  champions,
  pageSize = recommendationPageSize,
  resetKey,
}: RecommendationsListProps) {
  const pages = useMemo(() => paginate(recommendations, pageSize), [recommendations, pageSize]);
  const [pageCount, dispatch] = useReducer(pageCountReducer, 1);

  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [resetKey]);

  const visibleCount = Math.min(pageCount * pageSize, recommendations.length);
  const exhausted = visibleCount >= recommendations.length;

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-800/50">
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-sm font-bold text-indigo-300">{title}</h2>
      </div>
      {recommendations.length === 0 ? (
        <div className="p-6 text-center text-gray-500">{strings.recommendationEmpty}</div>
      ) : (
        <div className="p-4 space-y-3">
          {pages
            .slice(0, pageCount)
            .flat()
            .map((recommendation) => (
              <RecommendationCard
                key={recommendation.championId}
                recommendation={recommendation}
                champions={champions}
              />
            ))}
        </div>
      )}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
        <span role="status" aria-live="polite" className="text-xs text-gray-400">
          {strings.showing(visibleCount, recommendations.length)}
        </span>
        {!exhausted && recommendations.length > 0 && (
          <button
            onClick={() => dispatch({ type: 'showMore', maxPages: pages.length })}
            disabled={exhausted}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-100 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50 disabled:pointer-events-none"
          >
            {strings.showMore(Math.min(pageSize, recommendations.length - visibleCount))}
          </button>
        )}
      </div>
    </div>
  );
}
