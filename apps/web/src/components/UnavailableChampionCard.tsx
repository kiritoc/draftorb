/**
 * @draftorb/web — Card for a pool champion that cannot be recommended.
 *
 * Renders the "Not recommended" badge, the reason (insufficient data with
 * sample size and baseline win rate when available, already picked, or not in
 * the champion catalogue) inside the "From your pool" list (SPECS §7.1).
 */

import type { Champion, InsufficientDataEntry } from '@draftorb/shared';
import type { PoolUnavailableItem } from '../pool/unavailable.js';
import { strings } from '../strings.js';

export interface UnavailableChampionCardProps {
  item: PoolUnavailableItem;
  champions: Champion[];
}

const BADGE_CLASS: Record<PoolUnavailableItem['reason'], string> = {
  insufficientData: 'bg-amber-900/50 text-amber-300 border-amber-600/30',
  picked: 'bg-gray-800 text-gray-400 border-gray-600/30',
  unknownChampion: 'bg-red-900/50 text-red-400 border-red-500/30',
};

function championName(champions: Champion[], id: number): string {
  return champions.find((c) => c.id === id)?.name ?? strings.championFallback(id);
}

function formatNEff(nEff: number): string {
  return nEff.toFixed(1);
}

function formatWinRate(winRate: number | undefined): string {
  return winRate === undefined ? strings.missingValue : `${(winRate * 100).toFixed(1)}%`;
}

function insufficientDetail(sample: InsufficientDataEntry | undefined): string {
  if (sample === undefined) {
    return strings.insufficientDataLabel;
  }
  const parts = [`${strings.nEffLabel} ${formatNEff(sample.nEff)}`];
  if (sample.rawGames !== undefined) {
    parts.push(`${sample.rawGames} ${strings.gamesLabel}`);
  }
  return `${strings.insufficientDataLabel} · ${parts.join(' · ')}`;
}

function reasonDetail(item: PoolUnavailableItem): string {
  if (item.reason === 'insufficientData') {
    return insufficientDetail(item.sample);
  }
  return item.reason === 'picked' ? strings.poolReasonPicked : strings.poolReasonUnknownChampion;
}

export function UnavailableChampionCard({ item, champions }: UnavailableChampionCardProps) {
  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-base font-bold text-gray-300">
            {championName(champions, item.championId)}
          </h3>
          <span
            className={`px-1.5 py-0.5 rounded text-xs font-bold border ${BADGE_CLASS[item.reason]}`}
          >
            {strings.notRecommended}
          </span>
        </div>
        {item.reason === 'insufficientData' && (
          <span className="text-sm font-mono text-gray-400">
            {strings.winRateLabel} {formatWinRate(item.sample?.winRate)}
          </span>
        )}
      </div>
      <div className="text-xs text-gray-400">{reasonDetail(item)}</div>
    </div>
  );
}
