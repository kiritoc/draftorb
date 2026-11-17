import type { Role } from '@draftorb/shared';
import { personalRecord } from '../profile/personal-record';
import { syncedDate, type ProfileLoad } from '../profile/profile-export';
import { strings } from '../strings';

export interface RecordBadgeProps {
  load: ProfileLoad;
  championId: number;
  role: Role;
}

/** Personal record of a champion in a role (D-119); used by recommendation cards in BL-016b. */
export function RecordBadge({ load, championId, role }: RecordBadgeProps) {
  const className =
    'inline-block rounded-full bg-slate-200 px-3 py-1 text-sm text-slate-800 dark:bg-slate-700 dark:text-slate-100';
  if (load.kind !== 'loaded') return <span className={className}>{strings.recordNoData}</span>;
  const record = personalRecord(load.profile, championId, role);
  const text =
    record.winRate === null
      ? strings.recordNotEnough(record.games)
      : strings.recordWithRate(record.games, Math.round(record.winRate * 100));
  const title = strings.recordTooltip(
    load.profile.label,
    syncedDate(load.profile.syncedAt),
    load.profile.gameCount,
  );
  return (
    <span className={className} title={title}>
      {text}
    </span>
  );
}
