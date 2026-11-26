/**
 * A single recommendation card (port of the web component): rank, score,
 * per-reason level badges with delta/pp, reliability, warnings, champion
 * portrait and the personal-record badge (D-119, BL-018).
 */

import {
  COUNTERED_BY_WARNING,
  OFF_ROLE_WARNING,
  type Champion,
  type Reason,
  type Recommendation,
  type Role,
} from '@draftorb/shared';
import type { ProfileLoad } from '../profile/profile-export';
import { strings } from '../strings';
import { championName } from '../champion-name';
import { championIconUrl } from '../data/champion-icons';
import { ChampionPortrait } from './ChampionPortrait';
import { RecordBadge } from './RecordBadge';

export interface RecommendationCardProps {
  recommendation: Recommendation;
  champions: Champion[];
  iconVersion?: string | null;
  inPool?: boolean;
  /** Profile load for the personal-record badge; undefined hides it. */
  profileLoad?: ProfileLoad;
  role?: Role;
}

const LEVEL_LABEL: Record<number, string> = {
  '-3': strings.reasonStrongCounter,
  '-2': strings.reasonCounter,
  '-1': strings.reasonWeakCounter,
  '0': strings.reasonNeutral,
  '1': strings.reasonWeakSynergy,
  '2': strings.reasonSynergy,
  '3': strings.reasonStrongSynergy,
};

const LEVEL_CLASS: Record<number, string> = {
  '-3': 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-900/40 dark:text-red-300',
  '-2': 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-900/40 dark:text-red-300',
  '-1': 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-900/40 dark:text-orange-300',
  '0': 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
  '1': 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/40 dark:text-emerald-300',
  '2': 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/40 dark:text-emerald-300',
  '3': 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-900/40 dark:text-emerald-300',
};

function formatDeltaPp(deltaPp: number | undefined): string {
  if (deltaPp === undefined) return strings.deltaUnavailable;
  const sign = deltaPp >= 0 ? '+' : '−';
  return `${sign}${Math.abs(deltaPp).toFixed(1)}pp`;
}

export function warningText(warning: string, champions: Champion[]): string {
  if (warning === OFF_ROLE_WARNING) return strings.warningOffRole;
  const [code, role, championId] = warning.split(':');
  if (code === COUNTERED_BY_WARNING && role !== undefined && championId !== undefined) {
    const id = Number(championId);
    if (Number.isSafeInteger(id) && id > 0) {
      return strings.warningCounteredBy(role, championName(champions, id));
    }
  }
  return warning;
}

/** Short badge label for a reason: comp/blind use their own names, the rest
 * take the first word of the level label ("weak synergy" -> "weak"). */
function reasonBadgeLabel(reason: Reason): string {
  if (reason.type === 'comp') return strings.reasonComp;
  if (reason.type === 'blind') return strings.reasonBlind;
  return (LEVEL_LABEL[reason.level ?? 0] ?? strings.reasonNeutral).split(' ')[0] ?? '';
}

export function RecommendationCard({
  recommendation,
  champions,
  iconVersion = null,
  inPool = false,
  profileLoad,
  role,
}: RecommendationCardProps) {
  const { score, poolRank, reasons, reliability, warnings } = recommendation;
  const champion = champions.find((c) => c.id === recommendation.championId);
  const name = championName(champions, recommendation.championId);
  const winProb = (score * 100).toFixed(1);
  const warningList = warnings.map((warning) => warningText(warning, champions)).join(', ');

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ChampionPortrait
            name={name}
            iconUrl={champion !== undefined ? championIconUrl(iconVersion, champion.icon) : null}
            size="md"
          />
          <div className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-slate-400">#{recommendation.rank}</span>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{name}</h3>
              {(poolRank !== undefined || inPool) && (
                <span className="ml-1 rounded border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {poolRank !== undefined ? strings.inPoolRank(poolRank) : strings.inPoolTag}
                </span>
              )}
            </div>
            {profileLoad !== undefined && role !== undefined && (
              <RecordBadge load={profileLoad} championId={recommendation.championId} role={role} />
            )}
          </div>
        </div>
        <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400">
          {winProb}% {strings.winProbability}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {reasons.map((reason, index) => {
          const level = reason.level ?? 0;
          const label = LEVEL_LABEL[level] ?? strings.reasonNeutral;
          const withFirst = reason.with?.[0];
          return (
            <span
              key={index}
              className={`rounded border px-2 py-1 ${LEVEL_CLASS[level] ?? LEVEL_CLASS[0]}`}
              title={`${label} · ${formatDeltaPp(reason.deltaPp)}`}
            >
              {reasonBadgeLabel(reason)}
              {withFirst != null && strings.reasonVs(championName(champions, withFirst))}
              {reason.deltaPp != null && ` ${formatDeltaPp(reason.deltaPp)}`}
            </span>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <span>{strings.sampleSize}</span>
          <span className="font-mono">{reliability.nEff.toFixed(0)}</span>
          {reliability.lowData && (
            <span className="text-amber-600 dark:text-amber-400" title={strings.lowDataHint}>
              ⚠ {strings.lowDataLabel}
            </span>
          )}
        </div>
        {warnings.length > 0 && (
          <span
            className="text-red-600 dark:text-red-400"
            title={strings.warningLabel(warningList)}
          >
            ⚠ {warningList}
          </span>
        )}
      </div>
    </div>
  );
}
