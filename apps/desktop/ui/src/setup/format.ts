/**
 * Display helpers for the setup rune result (BL-030b, SPECS §18.5).
 *
 * Pure formatting only — every user-visible sentence lives in `strings.ts`
 * (CONVENTIONS). The helpers compose those templates so the honest-numbers
 * rules stay in one place: a rate is only formatted next to its sample
 * size, and an `insufficientData` page never gets a headline percentage.
 */

import type {
  SetupBroaderStatistic,
  SetupDataSource,
  SetupPageSource,
  SetupRunePage,
} from '@draftorb/shared';

import { strings } from '../strings';

/** Fraction -> one-decimal percent text without the `%` sign (`0.542` -> `54.2`). */
export function formatPercent(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

/**
 * The "Based on" label of the statistic behind a page (the adaptation hint,
 * D-103): which back-off level produced the figure. `sourceLevel` is the
 * expert contextLevel (1..3 lane slots, 4 damage mix, 5 global) or the
 * profile fallbackLevel (L1..L3 matchup, L4..L5 champion).
 */
export function pageSourceLabel(source: SetupPageSource, sourceLevel: number | null): string {
  switch (source) {
    case 'laneContext':
      return sourceLevel === null
        ? strings.setupContextNone
        : strings.setupContextLane(sourceLevel);
    case 'damageMix':
      return strings.setupContextDamageMix;
    case 'global':
      return strings.setupContextGlobal;
    case 'profileMatchup':
      return sourceLevel === null
        ? strings.setupContextNone
        : strings.setupContextMatchup(sourceLevel);
    case 'profileChampion':
      return sourceLevel === null
        ? strings.setupContextNone
        : strings.setupContextChampionRecord(sourceLevel);
    case 'none':
      return strings.setupContextNone;
  }
}

/**
 * One-line stats for a rune page. Sufficient pages lead with the shrunk win
 * rate; insufficient pages show "Not enough data" and never a bare rate
 * (D-075/D-102). Every number carries its sample: `n≈` effective games,
 * distinct expert players or raw profile games, plus pick share for expert
 * figures — and only when the page clears the evidence gate.
 */
export function pageStatsText(page: SetupRunePage): string {
  const parts: string[] = [];
  if (!page.insufficientData && page.winRate !== null) {
    parts.push(strings.setupWinRate(formatPercent(page.winRate)));
  } else {
    parts.push(strings.setupNotEnoughData);
  }
  parts.push(strings.setupNEff(page.nEff));
  if (page.players !== undefined) parts.push(strings.setupPlayers(page.players));
  if (page.games !== undefined) parts.push(strings.poolSampleGames(page.games));
  if (!page.insufficientData && page.pickShare !== undefined) {
    parts.push(strings.setupPickShare(formatPercent(page.pickShare)));
  }
  return parts.join(' · ');
}

/**
 * One-line stats for the D-103 broader-statistic fallback. Unlike pages, the
 * fallback shows its rate whenever weighted evidence exists and flags thin
 * samples with the low-data label (D-129 convention, BL-030a).
 */
export function broaderStatsText(stat: SetupBroaderStatistic): string {
  const parts: string[] = [];
  if (stat.winRate !== null) {
    parts.push(strings.setupWinRate(formatPercent(stat.winRate)));
  } else {
    parts.push(strings.setupNotEnoughData);
  }
  parts.push(strings.setupNEff(stat.nEff));
  if (stat.games !== undefined) parts.push(strings.poolSampleGames(stat.games));
  if (stat.insufficientData) parts.push(strings.lowDataLabel);
  return parts.join(' · ');
}

/** Human label of the dataset behind a result (shown next to the mode switch). */
export function dataSourceLabel(source: SetupDataSource, profileLabel?: string): string {
  return source === 'expertAggregate'
    ? strings.setupDataSourceExpert
    : strings.setupDataSourceProfile(profileLabel);
}
