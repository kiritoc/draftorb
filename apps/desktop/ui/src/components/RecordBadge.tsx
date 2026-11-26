import type { RankBucket, Role } from '@draftorb/shared';
import {
  championMetaRecord,
  championMetaSample,
  type BaselineIndex,
} from '../pick/baseline-record';
import { personalStats, type PersonalRecord } from '../profile/personal-record';
import { syncedDate, type ProfileLoad } from '../profile/profile-export';
import { strings } from '../strings';

export interface RecordBadgeProps {
  load: ProfileLoad;
  championId: number;
  role: Role;
  /** Per-bucket baseline lookup; undefined hides the champion-average row (BL-051). */
  baselineIndex?: BaselineIndex;
  /** Rank bucket the baseline index was built for; labels the average row. */
  rankBucket?: RankBucket;
}

function personalText(scope: string, record: PersonalRecord): string {
  return record.winRate === null
    ? strings.recordYouNotEnough(scope, record.games)
    : strings.recordYouRate(scope, record.games, Math.round(record.winRate * 100));
}

/**
 * Champion record on a card (D-119, BL-051): the champion's baseline average
 * at the selected rank, the profile's win rate on the champion across all
 * roles, and on the champion in the drafted role. Labels only — they never
 * change scores or ranks.
 */
export function RecordBadge({
  load,
  championId,
  role,
  baselineIndex,
  rankBucket,
}: RecordBadgeProps) {
  const chip =
    'inline-block w-fit rounded-full bg-slate-200 px-3 py-1 text-sm text-slate-800 dark:bg-slate-700 dark:text-slate-100';
  const meta =
    baselineIndex !== undefined && rankBucket !== undefined
      ? championMetaRecord(baselineIndex, championId)
      : undefined;
  const bucketLabel = rankBucket === undefined ? '' : strings.bucketNames[rankBucket];
  const thinSample =
    meta === null && baselineIndex !== undefined
      ? championMetaSample(baselineIndex, championId)
      : null;
  const insufficient = strings.recordMetaInsufficient(
    bucketLabel,
    thinSample === null ? undefined : Math.round(thinSample),
  );
  const stats = load.kind === 'loaded' ? personalStats(load.profile, championId, role) : null;
  const tooltip =
    load.kind === 'loaded'
      ? strings.recordTooltip(
          load.profile.label,
          syncedDate(load.profile.syncedAt),
          load.profile.gameCount,
        )
      : undefined;

  return (
    <div className="mt-1 flex flex-col gap-1">
      {meta !== undefined && (
        <span
          className={chip}
          title={
            meta === null
              ? insufficient
              : strings.recordMetaTooltip(bucketLabel, Math.round(meta.nEff))
          }
        >
          {meta === null
            ? insufficient
            : strings.recordMetaRate(
                bucketLabel,
                Math.round(meta.winRate * 100),
                Math.round(meta.nEff),
              )}
        </span>
      )}
      {stats === null ? (
        <span className={chip}>{strings.recordNoData}</span>
      ) : (
        <>
          <span className={chip} title={tooltip}>
            {personalText(strings.recordScopeAll, stats.overall)}
          </span>
          <span className={chip} title={tooltip}>
            {personalText(strings.roleNames[role], stats.role)}
          </span>
        </>
      )}
    </div>
  );
}
