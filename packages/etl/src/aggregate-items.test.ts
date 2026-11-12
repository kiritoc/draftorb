import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDb, migrate } from './db';
import { seedPatches } from './patches.test-helpers';
import { aggregateItemBuilds, type ItemBuildRow } from './aggregate-items';
import type { ItemClassEntry } from './item-classes';

const PATCH = '16.21';

// Test classes: 9001/9002 completed, 3865 quest_line starter, 9003 component,
// 3078 completed, 5001 quest_reward, 5002 jungle_path, 2003 consumable.
const TEST_CLASSES = new Map<number, ItemClassEntry>([
  [9001, { cls: 'completed' }],
  [9002, { cls: 'completed' }],
  [3078, { cls: 'completed' }],
  [3865, { cls: 'quest_line', laneFamily: 'support' }],
  [5001, { cls: 'quest_reward', laneFamily: 'support' }],
  [5002, { cls: 'jungle_path', laneFamily: 'jungle' }],
  [9003, { cls: 'component' }],
  [2003, { cls: 'consumable' }],
]);

interface ParticipantSpec {
  puuid: string;
  teamId: number;
  championId: number;
  role: string;
  win: number;
  championGames?: number;
  masteryPoints?: number | null;
  kills?: number;
  deaths?: number;
  assists?: number;
  itemsJson?: string;
}

const ALLY_CHAMPS = [
  { championId: 412, role: 'SUPPORT' },
  { championId: 21, role: 'ADC' },
  { championId: 14, role: 'TOP' },
  { championId: 64, role: 'JUNGLE' },
  { championId: 157, role: 'MID' },
];
const ENEMY_CHAMPS = [
  { championId: 266, role: 'SUPPORT' },
  { championId: 22, role: 'ADC' },
  { championId: 80, role: 'TOP' },
  { championId: 59, role: 'JUNGLE' },
  { championId: 12, role: 'MID' },
];

function baseParticipants(me: Partial<ParticipantSpec> = {}): ParticipantSpec[] {
  return [
    {
      puuid: 'p-me',
      teamId: 100,
      championId: 412,
      role: 'SUPPORT',
      win: 1,
      kills: 0,
      deaths: 1,
      assists: 10,
      itemsJson: '[9001]',
      ...me,
    },
    ...ALLY_CHAMPS.slice(1).map((c, i) => ({
      puuid: `p-ally-${i}`,
      teamId: 100,
      championId: c.championId,
      role: c.role,
      win: 1,
      kills: 2,
      deaths: 2,
      assists: 2,
      itemsJson: '[]',
    })),
    ...ENEMY_CHAMPS.map((c, i) => ({
      puuid: `p-enemy-${i}`,
      teamId: 200,
      championId: c.championId,
      role: c.role,
      win: 0,
      kills: 5,
      deaths: 1,
      assists: 5,
      itemsJson: '[3078]',
    })),
  ];
}

interface EventSpec {
  puuid?: string;
  ts: number;
  itemId: number;
  eventType?: 'purchase' | 'undo' | 'sold' | 'destroyed';
  beforeId?: number | null;
  afterId?: number | null;
  teamGoldDiff?: number;
  killsDiff?: number;
}

function seedGame(
  db: ReturnType<typeof openDb>,
  matchId: string,
  {
    patch = PATCH,
    participants = baseParticipants(),
    events = [],
    kills = [],
    createdAt = 1,
  }: {
    patch?: string;
    participants?: ParticipantSpec[];
    events?: EventSpec[];
    kills?: Array<{ tMs: number; killerPid?: number | null; victimPid: number }>;
    createdAt?: number;
  } = {},
): void {
  seedPatches(db, [patch]);
  db.prepare(
    `INSERT INTO matches (
      match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
    ) VALUES (?, 'euw1', ?, 420, 1800, ?, 6.5, 2)`,
  ).run(matchId, patch, createdAt);
  const insertParticipant = db.prepare(
    `INSERT INTO participants (
      match_id, puuid, team_id, champion_id, role, win, rank_score,
      champion_games, mastery_points, is_expert, keystone, primary_style,
      sub_style, perks_json, items_json, kills, deaths, assists
    ) VALUES (?, ?, ?, ?, ?, ?, 6.5, ?, ?, NULL, 8439, 8400, 8300, '{}', ?, ?, ?, ?)`,
  );
  const insertPid = db.prepare(
    'INSERT OR REPLACE INTO match_participant_ids (match_id, participant_id, puuid) VALUES (?, ?, ?)',
  );
  participants.forEach((p, i) => {
    insertParticipant.run(
      matchId,
      p.puuid,
      p.teamId,
      p.championId,
      p.role,
      p.win,
      p.championGames ?? 100,
      p.masteryPoints ?? null,
      p.itemsJson ?? '[]',
      p.kills ?? 0,
      p.deaths ?? 0,
      p.assists ?? 0,
    );
    insertPid.run(matchId, i + 1, p.puuid);
  });
  const insertEvent = db.prepare(
    `INSERT INTO item_events (
      match_id, participant_id, puuid, ts_ms, seq, event_type, item_id,
      before_id, after_id, team_gold_diff, kills_diff
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const pidOf = new Map(participants.map((p, i) => [p.puuid, i + 1]));
  events.forEach((e, i) => {
    const puuid = e.puuid ?? 'p-me';
    insertEvent.run(
      matchId,
      pidOf.get(puuid) ?? 1,
      puuid,
      e.ts,
      i,
      e.eventType ?? 'purchase',
      e.itemId,
      e.beforeId ?? null,
      e.afterId ?? null,
      e.teamGoldDiff ?? 0,
      e.killsDiff ?? 0,
    );
  });
  const insertKill = db.prepare(
    `INSERT INTO kill_events (match_id, seq, t_ms, killer_pid, victim_pid, assist_mask)
     VALUES (?, ?, ?, ?, ?, 0)`,
  );
  kills.forEach((k, i) => {
    insertKill.run(matchId, i, k.tMs, k.killerPid ?? null, k.victimPid);
  });
}

function writeTagsFile(dir: string): string {
  const tag = (championId: number, damageType: string) => ({
    championId,
    damageType,
    archetype: 'test',
    hardEngage: false,
    peel: false,
    poke: false,
    waveclear: false,
    scaling: { early: false, mid: true, late: true },
    range: 'RANGED',
    ccCount: 0,
  });
  const map: Record<string, unknown> = {};
  for (const c of ENEMY_CHAMPS) map[String(c.championId)] = tag(c.championId, 'AD');
  for (const c of ALLY_CHAMPS) map[String(c.championId)] = tag(c.championId, 'NONE');
  const path = join(dir, 'champion-tags.json');
  writeFileSync(path, JSON.stringify(map));
  return path;
}

const mockFetch =
  (items: Record<string, unknown> = {}): typeof fetch =>
  async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (url.endsWith('/api/versions.json')) {
      return json(['16.21.1', '16.20.1']);
    }
    if (url.includes('/data/en_US/item.json')) {
      return json({ data: items });
    }
    return new Response('not found', { status: 404 });
  };

const findRow = (
  rows: ItemBuildRow[],
  pred: (r: ItemBuildRow) => boolean,
): ItemBuildRow | undefined => rows.find(pred);

describe('aggregateItemBuilds', () => {
  it('writes item_build rows with D-022 context fields and path rows', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        events: [
          { ts: 10_000, itemId: 3865 }, // quest_line starter -> slot 0
          { ts: 400_000, itemId: 9001 }, // completed k=1 < 840s -> lane
          { ts: 900_000, itemId: 9001, teamGoldDiff: 3000 }, // k=2 mid
          { ts: 1_200_000, itemId: 9002 },
          { ts: 1_300_000, itemId: 5001 }, // quest_reward -> path row
        ],
      });
      const rows = await aggregateItemBuilds(db, {
        tagsPath,
        fetchFn: mockFetch(),
        itemClasses: TEST_CLASSES,
      });
      // 4 item rows + 1 path row.
      expect(rows.length).toBe(5);

      const starter = findRow(rows, (r) => r.slotIdx === 0);
      expect(starter).toMatchObject({
        championId: 412,
        myRole: 'SUPPORT',
        itemId: 3865,
        timeBucket: '0-5',
        decisionKind: 'item',
      });
      expect(starter?.laneKey.startsWith('lane:')).toBe(true);

      const first = findRow(rows, (r) => r.slotIdx === 1);
      expect(first).toMatchObject({ itemId: 9001, timeBucket: '5-10' });
      expect(first?.laneKey.startsWith('lane:')).toBe(true);

      const second = findRow(rows, (r) => r.slotIdx === 2);
      expect(second).toMatchObject({ timeBucket: '15-20', laneKey: '' });

      const path = findRow(rows, (r) => r.decisionKind === 'path');
      expect(path).toMatchObject({ itemId: 5001, slotIdx: 3 });
      expect(path?.profileKey).toBe('unknown'); // no kill_events seeded
    });
  });

  it('nets undo/sold/destroyed and ignores non-item classes', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        events: [
          { ts: 10_000, itemId: 3865 },
          { ts: 20_000, itemId: 9003 }, // component -> nothing
          { ts: 30_000, itemId: 9001 },
          { ts: 35_000, itemId: 9001, eventType: 'sold' }, // nets out
          { ts: 40_000, itemId: 9001 }, // re-buy -> still one completed item
          { ts: 50_000, itemId: 2003 }, // consumable -> nothing
          { ts: 60_000, itemId: 9002, eventType: 'undo', beforeId: 9002, afterId: null },
        ],
      });
      const rows = await aggregateItemBuilds(db, {
        tagsPath,
        fetchFn: mockFetch(),
        itemClasses: TEST_CLASSES,
      });
      const itemRows = rows.filter((r) => r.decisionKind === 'item');
      // slot0 starter + one completed (9001) at slot1; 9002 undo never counts.
      expect(itemRows.map((r) => r.itemId).sort()).toEqual([3865, 9001]);
      expect(findRow(rows, (r) => r.itemId === 9002)).toBeUndefined();
    });
  });

  it('writes participant_starters bundles', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        events: [
          { ts: 5_000, itemId: 3865 },
          { ts: 10_000, itemId: 2003 },
          { ts: 50_000, itemId: 9001 }, // outside 45s window
        ],
      });
      await aggregateItemBuilds(db, {
        tagsPath,
        fetchFn: mockFetch(),
        itemClasses: TEST_CLASSES,
      });
      const bundle = db
        .prepare(
          `SELECT bundle_json FROM participant_starters WHERE match_id = 'm1' AND participant_id = 1`,
        )
        .get() as { bundle_json: string } | undefined;
      // Net purchases in window: 3865 + 2003 (consumables count in the bundle).
      expect(bundle?.bundle_json).toBe('2003:1,3865:1');
    });
  });

  it('filters non-experts and applies the mastery fallback', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        participants: baseParticipants({ championGames: 5, masteryPoints: null }),
        events: [{ ts: 10_000, itemId: 3865 }],
      });
      seedGame(db, 'm2', {
        participants: baseParticipants({ championGames: 5, masteryPoints: 60_000 }),
        events: [{ ts: 10_000, itemId: 3865 }],
        createdAt: 2,
      });
      const rows = await aggregateItemBuilds(db, {
        tagsPath,
        fetchFn: mockFetch(),
        itemClasses: TEST_CLASSES,
      });
      expect(rows).toHaveLength(1);
    });
  });

  it('is idempotent: a second run produces identical rows', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        events: [
          { ts: 10_000, itemId: 3865 },
          { ts: 400_000, itemId: 9001 },
        ],
      });
      const opts = { tagsPath, fetchFn: mockFetch(), itemClasses: TEST_CLASSES };
      const first = await aggregateItemBuilds(db, opts);
      const second = await aggregateItemBuilds(db, opts);
      expect(second).toEqual(first);
      const stored = db.prepare('SELECT COUNT(*) AS n FROM item_build').get() as { n: number };
      expect(stored.n).toBe(first.length);
    });
  });

  it('leaves item_build untouched when nothing contributes', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', { events: [] });
      db.prepare(
        `INSERT INTO item_build (
          champion_id, my_role, slot_idx, time_bucket, state_bucket,
          profile_key, lane_key, decision_kind, item_id, wins_w, games_w, games_w2
        ) VALUES (1, 'SUPPORT', 0, '0-5', 'even', 'mixed', '', 'item', 1, 1, 1, 1)`,
      ).run();
      const rows = await aggregateItemBuilds(db, {
        tagsPath,
        fetchFn: mockFetch(),
        itemClasses: TEST_CLASSES,
      });
      expect(rows).toHaveLength(0);
      const stored = db.prepare('SELECT COUNT(*) AS n FROM item_build').get() as { n: number };
      expect(stored.n).toBe(1);
    });
  });

  it('accumulates weights across matches with decay and games_w2', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm-old', {
        patch: '16.20',
        createdAt: 1,
        events: [{ ts: 10_000, itemId: 3865 }],
      });
      seedGame(db, 'm-new', {
        patch: PATCH,
        createdAt: 2,
        events: [{ ts: 10_000, itemId: 3865 }],
      });
      const rows = await aggregateItemBuilds(db, {
        tagsPath,
        fetchFn: mockFetch(),
        itemClasses: TEST_CLASSES,
      });
      const row = findRow(
        rows,
        (r) => r.championId === 412 && r.myRole === 'SUPPORT' && r.itemId === 3865,
      );
      expect(row).toBeDefined();
      if (row === undefined) return;
      expect(row.gamesW2).toBeLessThan(row.gamesW * row.gamesW);
      expect(row.gamesW2).toBeGreaterThan(0);
    });
  });
});

async function withDbAsync(
  run: (db: ReturnType<typeof openDb>, tagsPath: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'draftorb-items-'));
  const tagsPath = writeTagsFile(dir);
  const db = openDb(join(dir, 'test.sqlite'));
  try {
    migrate(db);
    await run(db, tagsPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
