import { describe, expect, it } from 'vitest';
import type { RiotMatchTimeline } from './riot';
import { extractLaneSnapshots, LANE_SNAPSHOT_MINUTES } from './timeline-snapshots';

function timeline(frames: Array<Record<string, unknown>>): RiotMatchTimeline {
  return { info: { frames } } as unknown as RiotMatchTimeline;
}

const pf = (pid: number, over: Record<string, unknown> = {}) => ({
  participantId: pid,
  position: 'BOTTOM',
  level: 7,
  currentGold: 3000,
  xp: 12000,
  minionsKilled: 42,
  ...over,
});

describe('extractLaneSnapshots', () => {
  it('picks the first frame at-or-after each target minute', () => {
    const tl = timeline([
      { timestamp: 60_000, participantFrames: { '1': pf(1, { level: 2 }) } },
      { timestamp: 310_000, participantFrames: { '1': pf(1, { level: 4, currentGold: 5000 }) } },
      { timestamp: 600_500, participantFrames: { '1': pf(1, { level: 9, currentGold: 9000 }) } },
      { timestamp: 905_000, participantFrames: { '1': pf(1, { level: 11 }), '2': pf(2) } },
    ]);
    const rows = extractLaneSnapshots(tl);
    // minute 5 -> frame at 310s? No: first >=300s is 310_000? 310000>=300000 yes -> level 4
    const m5 = rows.filter((r) => r.minute === 5);
    expect(m5).toHaveLength(1);
    expect(m5[0]).toMatchObject({ participant_id: 1, level: 4, gold: 5000, cs: 42 });
    // minute 10 -> first >=600000 is 600_500 -> level 9
    const m10 = rows.find((r) => r.minute === 10 && r.participant_id === 1);
    expect(m10).toMatchObject({ level: 9, gold: 9000, ts_ms: 600_500 });
    // minute 15 -> first >=900000 is 905_000 -> both participants
    expect(rows.filter((r) => r.minute === 15)).toHaveLength(2);
    // minutes 20/25 have no later frame -> absent
    expect(rows.some((r) => r.minute === 20 || r.minute === 25)).toBe(false);
  });

  it('returns no rows for matches without participantFrames', () => {
    expect(extractLaneSnapshots(timeline([{ timestamp: 1000, events: [] }]))).toEqual([]);
    expect(extractLaneSnapshots(timeline([]))).toEqual([]);
  });

  it('skips non-numeric fields instead of storing garbage', () => {
    const tl = timeline([
      { timestamp: 305_000, participantFrames: { '7': pf(7, { level: 'x', xp: null }) } },
    ]);
    const rows = extractLaneSnapshots(tl);
    expect(rows[0]).toMatchObject({ participant_id: 7, level: null, xp: null, gold: 3000 });
  });

  it('covers all configured minutes', () => {
    expect(LANE_SNAPSHOT_MINUTES).toEqual([5, 10, 15, 20, 25]);
  });
});
