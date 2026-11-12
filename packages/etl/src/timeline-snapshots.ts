/**
 * @draftorb/etl — Lane snapshot extraction (Prompt-2 Phase 2).
 *
 * Picks, for each target minute, the first timeline frame at-or-after that
 * minute (frame timestamps are not exactly on the minute — Phase 0 payload
 * check) and records each participant's level/gold/XP/CS/position. Matches
 * without participantFrames (early surrender, remake) yield no rows.
 */

import type { RiotMatchTimeline } from './riot';

export const LANE_SNAPSHOT_MINUTES = [5, 10, 15, 20, 25] as const;

export interface LaneSnapshotRow {
  readonly participant_id: number;
  readonly minute: number;
  readonly ts_ms: number;
  readonly position: string | null;
  readonly level: number | null;
  readonly gold: number | null;
  readonly xp: number | null;
  readonly cs: number | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Extracts lane snapshots from a match-v5 timeline. Pure: no I/O.
 */
export function extractLaneSnapshots(timeline: RiotMatchTimeline): LaneSnapshotRow[] {
  const frames = [...timeline.info.frames]
    .filter((f) => f.timestamp !== undefined && f.participantFrames !== undefined)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  if (frames.length === 0) return [];

  const rows: LaneSnapshotRow[] = [];
  for (const minute of LANE_SNAPSHOT_MINUTES) {
    const target = minute * 60_000;
    const frame = frames.find((f) => (f.timestamp ?? 0) >= target);
    if (frame === undefined || frame.participantFrames === undefined) continue;
    const ts = frame.timestamp ?? 0;
    for (const [key, value] of Object.entries(frame.participantFrames)) {
      const participantId = num(value?.participantId) ?? Number(key);
      if (!Number.isInteger(participantId) || participantId <= 0) continue;
      rows.push({
        participant_id: participantId,
        minute,
        ts_ms: ts,
        position: str(value?.position),
        level: num(value?.level),
        gold: num(value?.currentGold),
        xp: num(value?.xp),
        cs: num(value?.minionsKilled),
      });
    }
  }
  return rows;
}
