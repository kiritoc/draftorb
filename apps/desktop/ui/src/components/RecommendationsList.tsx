/**
 * Paginated recommendations list — "From your pool" / "Best overall"
 * (port of the web component, D-024/SPECS §7.1). Always renders, pages of
 * `pageSize` (default 5) with a "Show more" button until exhausted.
 */

import { useMemo, useReducer, useState } from 'react';

import type { Champion, RankBucket, Recommendation, Role } from '@draftorb/shared';
import type { ProfileLoad } from '../profile/profile-export';
import type { BaselineIndex } from '../pick/baseline-record';
import { strings } from '../strings';
import { RECOMMENDATION_PAGE_SIZE } from '../config';
import { paginate } from '../pick/pagination';
import type { UnavailableItem } from '../pick/pool-unavailable';
import { RecommendationCard } from './RecommendationCard';
import { UnavailableChampionCard } from './UnavailableChampionCard';

/** Pagination event: reset on a new draft input, or reveal one more page. */
export interface PaginationAction {
  type: 'reset' | 'showMore';
  maxPages?: number;
}

/** Number of revealed pages; never exceeds `maxPages`. */
export function pageCountReducer(pageCount: number, action: PaginationAction): number {
  if (action.type === 'reset') return 1;
  return Math.min(pageCount + 1, action.maxPages ?? pageCount + 1);
}

type ListEntry =
  | { readonly type: 'recommendation'; readonly recommendation: Recommendation }
  | { readonly type: 'unavailable'; readonly item: UnavailableItem };

/** Everything a recommendation or unavailable card needs to render. */
export interface RecommendationCardContext {
  champions: Champion[];
  iconVersion?: string | null;
  profileLoad?: ProfileLoad;
  role?: Role;
  /** Baseline lookup + bucket for the champion-average badge row (BL-051). */
  baselineIndex?: BaselineIndex;
  rankBucket?: RankBucket;
}

export interface RecommendationsListProps {
  title: string;
  recommendations: Recommendation[];
  pageSize?: number;
  resetKey: unknown;
  poolIds?: ReadonlySet<number>;
  /** Set on the "From your pool" list: every unavailable card is a pool member
   *  by construction, so the "In your pool" tag would be redundant (SPECS §7.1). */
  poolMembershipImplied?: boolean;
  unavailable?: readonly UnavailableItem[];
  cardContext: RecommendationCardContext;
}

export function RecommendationsList({
  title,
  recommendations,
  pageSize = RECOMMENDATION_PAGE_SIZE,
  resetKey,
  poolIds,
  poolMembershipImplied = false,
  unavailable,
  cardContext,
}: RecommendationsListProps) {
  const entries = useMemo<ListEntry[]>(
    () => [
      ...recommendations.map((recommendation) => ({
        type: 'recommendation' as const,
        recommendation,
      })),
      ...(unavailable ?? []).map((item) => ({ type: 'unavailable' as const, item })),
    ],
    [recommendations, unavailable],
  );
  const pages = useMemo(() => paginate(entries, pageSize), [entries, pageSize]);
  const [pageCount, dispatch] = useReducer(pageCountReducer, 1);
  const [seenResetKey, setSeenResetKey] = useState(resetKey);
  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    dispatch({ type: 'reset' });
  }

  const visibleCount = Math.min(pageCount * pageSize, entries.length);
  const exhausted = visibleCount >= entries.length;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-800/60">
      <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-indigo-700 dark:border-slate-700 dark:text-indigo-300">
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="p-6 text-center text-slate-500 dark:text-slate-400">
          {strings.recommendationsEmpty}
        </p>
      ) : (
        <div className="space-y-3 p-4">
          {pages
            .slice(0, pageCount)
            .flat()
            .map((entry) =>
              entry.type === 'recommendation' ? (
                <RecommendationCard
                  key={entry.recommendation.championId}
                  recommendation={entry.recommendation}
                  champions={cardContext.champions}
                  iconVersion={cardContext.iconVersion}
                  inPool={poolIds?.has(entry.recommendation.championId) ?? false}
                  profileLoad={cardContext.profileLoad}
                  role={cardContext.role}
                  baselineIndex={cardContext.baselineIndex}
                  rankBucket={cardContext.rankBucket}
                />
              ) : (
                <UnavailableChampionCard
                  key={`unavailable-${entry.item.championId}`}
                  championId={entry.item.championId}
                  reason={entry.item.reason}
                  sample={entry.item.sample}
                  inPool={!poolMembershipImplied && (poolIds?.has(entry.item.championId) ?? false)}
                  champions={cardContext.champions}
                  iconVersion={cardContext.iconVersion}
                  profileLoad={cardContext.profileLoad}
                  role={cardContext.role}
                  baselineIndex={cardContext.baselineIndex}
                  rankBucket={cardContext.rankBucket}
                />
              ),
            )}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700">
        <span
          role="status"
          aria-live="polite"
          className="text-xs text-slate-500 dark:text-slate-400"
        >
          {strings.showingCount(visibleCount, entries.length)}
        </span>
        {!exhausted && entries.length > 0 && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'showMore', maxPages: pages.length })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {strings.showMore(Math.min(pageSize, entries.length - visibleCount))}
          </button>
        )}
      </div>
    </section>
  );
}
