import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { seedPatches } from './patches.test-helpers';
import { runTimelinePipeline } from './timeline';
import type { RiotMatchTimeline, RiotMatchTimelineEvent } from './riot';
import { RiotApiError, type RiotClient } from './riot';

const PATCH = '16.21';

function seedMatch(db: ReturnType<typeof openDb>, matchId: string): void {
  seedPatches(db, [PATCH]);
  db.prepare(
    `INSERT INTO matches (
      match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count, fetched_timeline
    ) VALUES (?, 'euw1', ?, 420, 1800, 1, 6.5, 2, 0)`,
  ).run(matchId, PATCH);
  const insertParticipant = db.prepare(
    `INSERT INTO participants (
      match_id, puuid, team_id, champion_id, role, win, rank_score,
      champion_games, mastery_points, is_expert, keystone, primary_style,
      sub_style, perks_json, items_json, kills, deaths, assists
    ) VALUES (?, ?, ?, ?, ?, ?, 6.5, 100, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
  );
  insertParticipant.run(matchId, 'puuid-a', 100, 412, 'SUPPORT', 1);
  insertParticipant.run(matchId, 'puuid-b', 200, 266, 'SUPPORT', 0);
}

function makeTimeline(events: RiotMatchTimelineEvent[]): RiotMatchTimeline {
  return {
    info: {
      gameId: 1,
      participants: [
        { participantId: 1, puuid: 'puuid-a' },
        { participantId: 2, puuid: 'puuid-b' },
      ],
      frames: [
        {
          timestamp: 0,
          events,
          participantFrames: {
            '1': { participantId: 1, currentGold: 500 },
            '2': { participantId: 2, currentGold: 500 },
          },
        },
      ],
    },
  } as RiotMatchTimeline;
}

function mockClient(timeline: RiotMatchTimeline | Error): RiotClient {
  return {
    getMatchTimeline: vi.fn(async () => {
      if (timeline instanceof Error) throw timeline;
      return timeline;
    }),
  } as unknown as RiotClient;
}

function withDb(run: (db: ReturnType<typeof openDb>) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'draftorb-timeline-'));
  const db = openDb(join(dir, 'test.sqlite'));
  return (async () => {
    try {
      migrate(db);
      await run(db);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

const extractorRuns = (db: ReturnType<typeof openDb>, matchId: string) =>
  (
    db
      .prepare('SELECT extractor FROM extractor_runs WHERE match_id = ? ORDER BY extractor')
      .all(matchId) as Array<{ extractor: string }>
  ).map((r) => r.extractor);

const itemEventRows = (db: ReturnType<typeof openDb>, matchId: string) =>
  db
    .prepare(
      `SELECT participant_id, puuid, ts_ms, seq, event_type, item_id, before_id, after_id,
              team_gold_diff, kills_diff
       FROM item_events WHERE match_id = ? ORDER BY ts_ms, seq`,
    )
    .all(matchId) as Array<Record<string, unknown>>;

describe('runTimelinePipeline', () => {
  it('writes raw item_events, kill_events, participant ids and extractor_runs', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(
        makeTimeline([
          { timestamp: 10_000, type: 'ITEM_PURCHASED', participantId: 1, itemId: 3865 },
          { timestamp: 400_000, type: 'ITEM_PURCHASED', participantId: 1, itemId: 9001 },
          { timestamp: 400_000, type: 'ITEM_PURCHASED', participantId: 1, itemId: 2003 },
          { timestamp: 500_000, type: 'ITEM_SOLD', participantId: 1, itemId: 9001 },
          {
            timestamp: 600_000,
            type: 'CHAMPION_KILL',
            killerId: 2,
            victimId: 1,
            assistingParticipantIds: [2],
            bounty: 300,
          },
        ]),
      );
      const result = await runTimelinePipeline({ db, client });
      expect(result.fetched).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.extractorsDone).toBe(3);
      expect(extractorRuns(db, 'm1')).toEqual(['item-events', 'kill-events', 'participant-ids']);

      const rows = itemEventRows(db, 'm1');
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.event_type)).toEqual(['purchase', 'purchase', 'purchase', 'sold']);
      // Same-ms duplicate purchases get distinct seq values.
      const sameMs = rows.filter((r) => r.ts_ms === 400_000);
      expect(new Set(sameMs.map((r) => r.seq)).size).toBe(2);

      const kills = db
        .prepare('SELECT killer_pid, victim_pid, assist_mask FROM kill_events WHERE match_id = ?')
        .all('m1') as Array<Record<string, unknown>>;
      expect(kills).toHaveLength(1);
      expect(kills[0]).toMatchObject({ killer_pid: 2, victim_pid: 1 });

      const pids = db
        .prepare(
          'SELECT participant_id, puuid FROM match_participant_ids WHERE match_id = ? ORDER BY participant_id',
        )
        .all('m1') as Array<Record<string, unknown>>;
      expect(pids).toEqual([
        { participant_id: 1, puuid: 'puuid-a' },
        { participant_id: 2, puuid: 'puuid-b' },
      ]);
    });
  });

  it('is a no-op on a second run (extractor_runs complete)', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(makeTimeline([]));
      await runTimelinePipeline({ db, client });
      const again = await runTimelinePipeline({ db, client });
      expect(again.candidates).toBe(0);
      expect(client.getMatchTimeline).toHaveBeenCalledTimes(1);
    });
  });

  it('resumes per extractor: a match missing one extractor still fetches', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      // Simulate a previous partial run: only item-events done.
      db.prepare(
        "INSERT INTO extractor_runs (match_id, extractor) VALUES ('m1', 'item-events')",
      ).run();
      const client = mockClient(makeTimeline([]));
      const result = await runTimelinePipeline({ db, client });
      expect(result.fetched).toBe(1);
      expect(extractorRuns(db, 'm1')).toHaveLength(3);
      expect(client.getMatchTimeline).toHaveBeenCalledTimes(1);
    });
  });

  it('marks nothing on transient failure so the match retries', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(new RiotApiError('boom', 500, 'https://x'));
      const result = await runTimelinePipeline({ db, client });
      expect(result.failed).toBe(1);
      expect(extractorRuns(db, 'm1')).toHaveLength(0);
    });
  });

  it('stops early after 3 consecutive transient failures', async () => {
    await withDb(async (db) => {
      for (const id of ['m1', 'm2', 'm3', 'm4']) seedMatch(db, id);
      const client = mockClient(new RiotApiError('boom', 429, 'https://x'));
      const result = await runTimelinePipeline({ db, client });
      expect(result.stoppedEarly).toBe(true);
      expect(result.failed).toBe(3);
      expect(client.getMatchTimeline).toHaveBeenCalledTimes(3);
    });
  });

  it('skips matches whose timeline has no usable participant map', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const tl = makeTimeline([]) as { info: Record<string, unknown> };
      delete tl.info.participants;
      const client = mockClient(tl as RiotMatchTimeline);
      const result = await runTimelinePipeline({ db, client });
      expect(result.skipped).toBe(1);
      expect(result.fetched).toBe(0);
      expect(extractorRuns(db, 'm1')).toHaveLength(3);
    });
  });

  it('respects --call-budget', async () => {
    await withDb(async (db) => {
      for (const id of ['m1', 'm2', 'm3']) seedMatch(db, id);
      const client = mockClient(makeTimeline([]));
      const result = await runTimelinePipeline({ db, client, callBudget: 2 });
      expect(result.budgetExhausted).toBe(true);
      expect(client.getMatchTimeline).toHaveBeenCalledTimes(2);
      const again = await runTimelinePipeline({ db, client });
      expect(again.fetched).toBe(1);
    });
  });

  it('attributes pseudo participantId 0 purchases to a support', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(
        makeTimeline([{ timestamp: 0, type: 'ITEM_PURCHASED', participantId: 0, itemId: 3865 }]),
      );
      await runTimelinePipeline({ db, client });
      const rows = itemEventRows(db, 'm1');
      // Both participants are SUPPORT; the first eligible (pid 1) gets it.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ participant_id: 1, item_id: 3865 });
    });
  });
});
