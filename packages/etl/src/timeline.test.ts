import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { seedPatches } from './patches.test-helpers';
import { ingestTimelines } from './timeline';
import type { RiotMatchTimeline, RiotMatchTimelineEvent } from './riot';
import { RiotApiError, type RiotClient } from './riot';

const PATCH = '16.21';

function seedMatch(
  db: ReturnType<typeof openDb>,
  matchId: string,
  { fetchedTimeline = 0 }: { fetchedTimeline?: number } = {},
): void {
  seedPatches(db, [PATCH]);
  db.prepare(
    `INSERT INTO matches (
      match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count, fetched_timeline
    ) VALUES (?, 'euw1', ?, 420, 1800, 1, 6.5, 2, ?)`,
  ).run(matchId, PATCH, fetchedTimeline);
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

/** Minimal catalog: 9001 completed, 3865 lane starter, 2003 consumable. */
const rawItem = (id: number, into: string[], tags: string[]) => ({
  name: `item-${id}`,
  image: { full: `${id}.png` },
  gold: { base: 0, purchasable: true, total: 1000, sell: 0 },
  tags,
  from: [],
  into,
});

const mockFetch =
  (items: Record<string, unknown> | null = null): typeof fetch =>
  async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (url.endsWith('/api/versions.json')) return json(['16.21.1']);
    if (url.includes('/data/en_US/item.json')) {
      return json({
        data: items ?? {
          '9001': rawItem(9001, [], []),
          '3865': rawItem(3865, [], ['Health', 'GoldPer', 'Lane']),
          '2003': rawItem(2003, [], ['Consumable', 'Lane']),
        },
      });
    }
    return new Response('not found', { status: 404 });
  };

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

const fetchedFlag = (db: ReturnType<typeof openDb>, matchId: string): number =>
  (
    db.prepare('SELECT fetched_timeline AS f FROM matches WHERE match_id = ?').get(matchId) as {
      f: number;
    }
  ).f;

const eventRows = (db: ReturnType<typeof openDb>, matchId: string) =>
  db
    .prepare(
      'SELECT puuid, ts, item_id, type, team_gold_diff, kills_diff, item_slot FROM item_events WHERE match_id = ? ORDER BY ts, puuid',
    )
    .all(matchId) as Array<Record<string, unknown>>;

describe('ingestTimelines', () => {
  it('fetches timelines, writes item_events and marks fetched_timeline', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(
        makeTimeline([
          { timestamp: 10_000, type: 'ITEM_PURCHASED', participantId: 1, itemId: 3865 },
          { timestamp: 400_000, type: 'ITEM_PURCHASED', participantId: 1, itemId: 9001 },
          { timestamp: 500_000, type: 'ITEM_PURCHASED', participantId: 2, itemId: 2003 },
        ]),
      );
      const result = await ingestTimelines({ db, client, fetchFn: mockFetch() });
      expect(result).toMatchObject({ candidates: 1, fetched: 1, events: 3, failed: 0 });
      expect(fetchedFlag(db, 'm1')).toBe(1);

      const rows = eventRows(db, 'm1');
      expect(rows).toHaveLength(3);
      const starter = rows.find((r) => r.item_id === 3865);
      expect(starter).toMatchObject({ puuid: 'puuid-a', item_slot: 0, type: 'purchase' });
      const completed = rows.find((r) => r.item_id === 9001);
      expect(completed).toMatchObject({ puuid: 'puuid-a', item_slot: 1 });
      const consumable = rows.find((r) => r.item_id === 2003);
      expect(consumable).toMatchObject({ puuid: 'puuid-b', item_slot: null });
    });
  });

  it('is a no-op on a second run (fetched_timeline = 1)', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(makeTimeline([]));
      await ingestTimelines({ db, client, fetchFn: mockFetch() });
      const again = await ingestTimelines({ db, client, fetchFn: mockFetch() });
      expect(again.candidates).toBe(0);
      expect(client.getMatchTimeline).toHaveBeenCalledTimes(1);
    });
  });

  it('re-ingesting rewrites events idempotently when the flag is reset', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(
        makeTimeline([
          { timestamp: 10_000, type: 'ITEM_PURCHASED', participantId: 1, itemId: 3865 },
        ]),
      );
      await ingestTimelines({ db, client, fetchFn: mockFetch() });
      db.prepare('UPDATE matches SET fetched_timeline = 0 WHERE match_id = ?').run('m1');
      await ingestTimelines({ db, client, fetchFn: mockFetch() });
      expect(eventRows(db, 'm1')).toHaveLength(1);
    });
  });

  it('keeps fetched_timeline = 0 on transient failure so the match retries', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(new RiotApiError('boom', 500, 'https://x'));
      const result = await ingestTimelines({ db, client, fetchFn: mockFetch() });
      expect(result.failed).toBe(1);
      expect(fetchedFlag(db, 'm1')).toBe(0);
      expect(eventRows(db, 'm1')).toHaveLength(0);
    });
  });

  it('stops early after 3 consecutive transient failures', async () => {
    await withDb(async (db) => {
      for (const id of ['m1', 'm2', 'm3', 'm4']) seedMatch(db, id);
      const client = mockClient(new RiotApiError('boom', 429, 'https://x'));
      const result = await ingestTimelines({ db, client, fetchFn: mockFetch() });
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
      const result = await ingestTimelines({ db, client, fetchFn: mockFetch() });
      expect(result.skipped).toBe(1);
      expect(result.fetched).toBe(0);
      // Consumed anyway: a payload without participants can never map ids.
      expect(fetchedFlag(db, 'm1')).toBe(1);
      expect(eventRows(db, 'm1')).toHaveLength(0);
    });
  });

  it('skips matches whose patch has no item catalog', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = mockClient(makeTimeline([]));
      // versions.json lists only 16.22 -> patch 16.21 unresolved.
      const fetchFn: typeof fetch = async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/api/versions.json')) {
          return new Response(JSON.stringify(['16.22.1']), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };
      const result = await ingestTimelines({ db, client, fetchFn });
      expect(result.skipped).toBe(1);
      expect(result.fetched).toBe(0);
      expect(fetchedFlag(db, 'm1')).toBe(0); // stays retryable
      expect(client.getMatchTimeline).not.toHaveBeenCalled();
    });
  });
});
