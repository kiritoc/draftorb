/**
 * @draftorb/web — A single recommendation card.
 *
 * Renders a `Recommendation`: rank, score, per-reason level badges with
 * delta/pp and sample size, reliability, and warnings. Receives the champion
 * catalogue to resolve ids to names.
 */

import { type Champion, type Recommendation } from '@draftorb/shared';

export interface RecommendationCardProps {
  recommendation: Recommendation;
  champions: Champion[];
}

const LEVEL_LABEL: Record<number, string> = {
  '-3': 'Strong counter',
  '-2': 'Counter',
  '-1': 'Weak counter',
  '0': 'Neutral',
  '1': 'Weak synergy',
  '2': 'Synergy',
  '3': 'Strong synergy',
};

const LEVEL_CLASS: Record<number, string> = {
  '-3': 'bg-red-900/50 text-red-400 border-red-500/30',
  '-2': 'bg-red-900/50 text-red-400 border-red-500/30',
  '-1': 'bg-orange-900/50 text-orange-400 border-orange-500/30',
  '0': 'bg-gray-800 text-gray-400 border-gray-600/30',
  '1': 'bg-emerald-900/50 text-emerald-400 border-emerald-500/30',
  '2': 'bg-emerald-900/50 text-emerald-400 border-emerald-500/30',
  '3': 'bg-emerald-900/50 text-emerald-400 border-emerald-500/30',
};

function championName(champions: Champion[], id: number): string {
  return champions.find((c) => c.id === id)?.name ?? `Champion ${id}`;
}

function formatDeltaPp(deltaPp: number | undefined): string {
  if (deltaPp === undefined) {
    return '—';
  }
  const sign = deltaPp >= 0 ? '+' : '−';
  return `${sign}${Math.abs(deltaPp).toFixed(1)}pp`;
}

function formatSampleSize(n: number | undefined): string {
  if (n === undefined) {
    return '—';
  }
  return `${n.toFixed(0)}`;
}

export function RecommendationCard({ recommendation, champions }: RecommendationCardProps) {
  const { score, poolRank, reasons, reliability, warnings } = recommendation;
  const name = championName(champions, recommendation.championId);
  const winProb = (score * 100).toFixed(1);

  return (
    <div className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-mono text-gray-500">#{recommendation.rank}</span>
          <h3 className="text-base font-bold text-gray-100">{name}</h3>
          {poolRank !== undefined && (
            <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-bold bg-indigo-900/50 text-indigo-300 border border-indigo-600/30">
              In your pool · #{poolRank}
            </span>
          )}
        </div>
        <span className="text-sm font-mono text-indigo-400">{winProb}% win</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {reasons.map((reason, index) => {
          const level = reason.level ?? 0;
          const label = LEVEL_LABEL[level] ?? 'Neutral';
          const withFirst = reason.with?.[0];
          return (
            <span
              key={index}
              className={`px-2 py-1 rounded border ${LEVEL_CLASS[level] ?? LEVEL_CLASS[0]}`}
              title={`${label} · ${formatDeltaPp(reason.deltaPp)}`}
            >
              {reason.type === 'comp' || reason.type === 'blind'
                ? reason.type.toUpperCase()
                : label.split(' ')[0]}
              {withFirst != null && ` vs ${championName(champions, withFirst)}`}
              {reason.deltaPp != null && ` ${formatDeltaPp(reason.deltaPp)}`}
            </span>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <span>Sample:</span>
          <span className="font-mono">{formatSampleSize(reliability.nEff)}</span>
          {reliability.lowData && (
            <span className="text-amber-400" title="Low effective sample size">
              ⚠ low data
            </span>
          )}
        </div>
        {warnings.length > 0 && (
          <span className="text-red-400" title={warnings.join(', ')}>
            ⚠ {warnings.join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
