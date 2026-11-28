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
  SetupStarterSource,
  StarterBundleItem,
} from '@draftorb/shared';

import type { ItemIconInfo } from '../data/items';
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
 * The sample-size fields every setup pick shares (rune page, spell pair,
 * starter bundle). `players`/`pickShare` exist only for expert figures;
 * `games` only for profile figures.
 */
export interface SetupPickStats {
  readonly winRate: number | null;
  readonly nEff: number;
  readonly games?: number;
  readonly players?: number;
  readonly pickShare?: number;
  readonly insufficientData: boolean;
}

/**
 * One-line stats for any setup pick (rune page, spell pair, starter
 * bundle). Sufficient picks lead with the shrunk win rate; insufficient
 * picks show "Not enough data" and never a bare rate (D-075/D-102). Every
 * number carries its sample: `n≈` effective games, distinct expert players
 * or raw profile games, plus pick share for expert figures — and only when
 * the pick clears the evidence gate.
 */
export function pickStatsText(pick: SetupPickStats): string {
  const parts: string[] = [];
  if (!pick.insufficientData && pick.winRate !== null) {
    parts.push(strings.setupWinRate(formatPercent(pick.winRate)));
  } else {
    parts.push(strings.setupNotEnoughData);
  }
  parts.push(strings.setupNEff(pick.nEff));
  if (pick.players !== undefined) parts.push(strings.setupPlayers(pick.players));
  if (pick.games !== undefined) parts.push(strings.poolSampleGames(pick.games));
  if (!pick.insufficientData && pick.pickShare !== undefined) {
    parts.push(strings.setupPickShare(formatPercent(pick.pickShare)));
  }
  return parts.join(' · ');
}

/** One-line stats for a rune page (kept for the rune section call sites). */
export function pageStatsText(page: SetupRunePage): string {
  return pickStatsText(page);
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

/**
 * "Based on" label of the statistic behind a starter bundle (the D-103
 * adaptation hint): the expert starter back-off chain is exact lane ->
 * champion -> role -> global (D-134/D-086 bundle half); profile bundles
 * use the D-073 matchup/champion fallback levels like runes and spells
 * (BL-059).
 */
export function starterSourceLabel(source: SetupStarterSource, sourceLevel: number | null): string {
  switch (source) {
    case 'laneContext':
      return sourceLevel === null
        ? strings.setupContextNone
        : strings.setupContextLane(sourceLevel);
    case 'championContext':
      return sourceLevel === null
        ? strings.setupContextNone
        : strings.setupContextChampionLevel(sourceLevel);
    case 'roleContext':
      return sourceLevel === null
        ? strings.setupContextNone
        : strings.setupContextRoleLevel(sourceLevel);
    case 'global':
      return strings.setupContextGlobalAll;
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
 * Display label of a starter bundle: catalog item names joined by ` + `,
 * with `×N` for stacked counts. Unknown ids fall back to a labeled
 * `Item <id>` (golden rule 8 — never a blank or invented name).
 */
export function starterItemsLabel(
  bundleItems: readonly StarterBundleItem[],
  catalog: ReadonlyMap<number, ItemIconInfo>,
): string {
  return bundleItems
    .map((item) => {
      const name = catalog.get(item.itemId)?.name ?? strings.itemFallback(item.itemId);
      return item.count > 1 ? `${name} ×${item.count}` : name;
    })
    .join(' + ');
}
