/**
 * Pool champion without a score, rendered after the ranked pool entries
 * with a "Not recommended" badge (port of the web component, SPECS §7.1).
 */

import type { Champion, InsufficientDataEntry, RankBucket, Role } from '@draftorb/shared';
import type { ProfileLoad } from '../profile/profile-export';
import type { BaselineIndex } from '../pick/baseline-record';
import { strings } from '../strings';
import { championName } from '../champion-name';
import { championIconUrl } from '../data/champion-icons';
import { ChampionPortrait } from './ChampionPortrait';
import { RecordBadge } from './RecordBadge';

export interface UnavailableChampionCardProps {
  championId: number;
  reason: 'insufficientData' | 'unknownChampion' | 'picked' | 'banned';
  sample?: InsufficientDataEntry;
  champions: Champion[];
  iconVersion?: string | null;
  /** Record badge inputs (BL-051); both undefined hides the badge. */
  profileLoad?: ProfileLoad;
  role?: Role;
  baselineIndex?: BaselineIndex;
  rankBucket?: RankBucket;
}

const REASON_LABEL: Record<UnavailableChampionCardProps['reason'], string> = {
  insufficientData: strings.reasonInsufficientData,
  unknownChampion: strings.reasonUnknownChampion,
  picked: strings.reasonPicked,
  banned: strings.reasonBanned,
};

export function UnavailableChampionCard({
  championId,
  reason,
  sample,
  champions,
  iconVersion = null,
  profileLoad,
  role,
  baselineIndex,
  rankBucket,
}: UnavailableChampionCardProps) {
  const champion = champions.find((c) => c.id === championId);
  const name = championName(champions, championId);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800/40">
      <ChampionPortrait
        name={name}
        iconUrl={champion !== undefined ? championIconUrl(iconVersion, champion.icon) : null}
        size="md"
      />
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-slate-500 dark:text-slate-300">{name}</h3>
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {strings.notRecommended}
          </span>
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {REASON_LABEL[reason]}
          {reason === 'insufficientData' && sample !== undefined && (
            <>
              {' '}
              · {strings.sampleSize} {sample.nEff.toFixed(1)}
              {sample.rawGames !== undefined && ` · ${strings.poolSampleGames(sample.rawGames)}`}
              {sample.winRate !== undefined &&
                ` · ${strings.poolBaselineWinRate(sample.winRate * 100)}`}
            </>
          )}
        </span>
        {profileLoad !== undefined && role !== undefined && (
          <RecordBadge
            load={profileLoad}
            championId={championId}
            role={role}
            baselineIndex={baselineIndex}
            rankBucket={rankBucket}
          />
        )}
      </div>
    </div>
  );
}
