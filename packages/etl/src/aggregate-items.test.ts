import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDb, migrate } from './db';
import { seedPatches } from './patches.test-helpers';
import { aggregateItemBuilds, type ItemBuildRow } from './aggregate-items';

const PATCH = '16.21';

// Champion ids reused from the rune tests: me = Soraka (412) SUPPORT.
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

interface PurchaseSpec {
  puuid?: string;
  ts: number;
  itemId: number;
  itemSlot: number | null;
  type?: 'purchase' | 'sold';
  teamGoldDiff?: number;
  killsDiff?: number;
}

function seedGame(
  db: ReturnType<typeof openDb>,
  matchId: string,
  {
    patch = PATCH,
    participants = baseParticipants(),
    purchases = [],
    createdAt = 1,
  }: {
    patch?: string;
    participants?: ParticipantSpec[];
    purchases?: PurchaseSpec[];
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
  for (const p of participants) {
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
  }
  const insertEvent = db.prepare(
    `INSERT INTO item_events (
      match_id, puuid, ts, item_id, type, team_gold_diff, kills_diff, item_slot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const purchase of purchases) {
    insertEvent.run(
      matchId,
      purchase.puuid ?? 'p-me',
      purchase.ts,
      purchase.itemId,
      purchase.type ?? 'purchase',
      purchase.teamGoldDiff ?? 0,
      purchase.killsDiff ?? 0,
      purchase.itemSlot,
    );
  }
}

/** Champion tags fixture: enemies are all AD, allies mixed/NONE. */
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

/** Mock Data Dragon: versions.json + a minimal item.json per version. */
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
  it('writes item_build rows with D-022 context fields', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        purchases: [
          { ts: 10_000, itemId: 3865, itemSlot: 0 }, // lane phase
          { ts: 400_000, itemId: 9001, itemSlot: 1, teamGoldDiff: -500 }, // k=1 < 840 s -> lane
          { ts: 900_000, itemId: 9001, itemSlot: 2, teamGoldDiff: 3000 }, // mid, ahead
          { ts: 1_200_000, itemId: 9002, itemSlot: 3 },
        ],
      });
      const rows = await aggregateItemBuilds(db, { tagsPath, fetchFn: mockFetch() });
      expect(rows.length).toBe(4);

      const starter = findRow(rows, (r) => r.slotIdx === 0);
      expect(starter).toMatchObject({
        championId: 412,
        myRole: 'SUPPORT',
        itemId: 3865,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
      });
      expect(starter?.laneKey.startsWith('lane:')).toBe(true);
      expect(starter?.laneKey).toContain('ADC:21');
      expect(starter?.laneKey).toContain('SUPPORT:266');

      const first = findRow(rows, (r) => r.slotIdx === 1);
      expect(first).toMatchObject({ timeBucket: '5-10', stateBucket: 'even' });
      expect(first?.laneKey.startsWith('lane:')).toBe(true);

      const second = findRow(rows, (r) => r.slotIdx === 2);
      expect(second).toMatchObject({
        timeBucket: '15-20',
        stateBucket: 'ahead', // gold diff 3000 >= 2000
        laneKey: '', // mid phase: no lane key
      });

      const third = findRow(rows, (r) => r.slotIdx === 3);
      expect(third?.laneKey).toBe('');

      for (const row of rows) {
        expect(row.gamesW).toBeGreaterThan(0);
        expect(row.gamesW2).toBeGreaterThan(0);
        expect(row.winsW).toBeGreaterThan(0); // team 100 won
      }
    });
  });

  it("ignores sold rows, NULL-slot purchases and other players' non-expert games", async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        purchases: [
          { ts: 10_000, itemId: 3865, itemSlot: 0 },
          { ts: 20_000, itemId: 9003, itemSlot: null }, // component -> no slot
          { ts: 30_000, itemId: 9001, itemSlot: null, type: 'sold' },
          { ts: 40_000, itemId: 9001, itemSlot: 1, puuid: 'p-ally-0' }, // ally's purchase
        ],
      });
      const rows = await aggregateItemBuilds(db, { tagsPath, fetchFn: mockFetch() });
      // Only the expert SUPPORT participant contributes; ally-0 is also an
      // expert on their own champion, so its purchase lands under ITS champion.
      expect(rows.every((r) => r.myRole === 'SUPPORT' || r.myRole === 'ADC')).toBe(true);
      const supportRows = rows.filter((r) => r.myRole === 'SUPPORT');
      expect(supportRows.map((r) => r.itemId)).toEqual([3865]);
      const adcRow = findRow(rows, (r) => r.myRole === 'ADC');
      expect(adcRow?.championId).toBe(21);
      expect(adcRow?.itemId).toBe(9001);
    });
  });

  it('filters non-experts and applies the mastery fallback', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        participants: baseParticipants({ championGames: 5, masteryPoints: null }),
        purchases: [{ ts: 10_000, itemId: 3865, itemSlot: 0 }],
      });
      seedGame(db, 'm2', {
        participants: baseParticipants({ championGames: 5, masteryPoints: 60_000 }),
        purchases: [{ ts: 10_000, itemId: 3865, itemSlot: 0 }],
        createdAt: 2,
      });
      const rows = await aggregateItemBuilds(db, { tagsPath, fetchFn: mockFetch() });
      // Only m2 (mastery fallback) contributes.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.gamesW).toBeGreaterThan(0);
    });
  });

  it('is idempotent: a second run produces identical rows', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', {
        purchases: [
          { ts: 10_000, itemId: 3865, itemSlot: 0 },
          { ts: 400_000, itemId: 9001, itemSlot: 1 },
        ],
      });
      const first = await aggregateItemBuilds(db, { tagsPath, fetchFn: mockFetch() });
      const second = await aggregateItemBuilds(db, { tagsPath, fetchFn: mockFetch() });
      expect(second).toEqual(first);
      const stored = db.prepare('SELECT COUNT(*) AS n FROM item_build').get() as { n: number };
      expect(stored.n).toBe(first.length);
    });
  });

  it('leaves item_build untouched when nothing contributes', async () => {
    await withDbAsync(async (db, tagsPath) => {
      seedGame(db, 'm1', { purchases: [] });
      db.prepare(
        `INSERT INTO item_build (
          champion_id, my_role, slot_idx, time_bucket, state_bucket,
          profile_key, lane_key, item_id, wins_w, games_w, games_w2
        ) VALUES (1, 'SUPPORT', 0, '0-5', 'even', 'mixed', '', 1, 1, 1, 1)`,
      ).run();
      const rows = await aggregateItemBuilds(db, { tagsPath, fetchFn: mockFetch() });
      expect(rows).toHaveLength(0);
      const stored = db.prepare('SELECT COUNT(*) AS n FROM item_build').get() as { n: number };
      expect(stored.n).toBe(1);
    });
  });

  it('accumulates weights across matches with decay and games_w2', async () => {
    await withDbAsync(async (db, tagsPath) => {
      // Same context in two patches: weight differs by recency decay.
      seedGame(db, 'm-old', {
        patch: '16.20',
        createdAt: 1,
        purchases: [{ ts: 10_000, itemId: 3865, itemSlot: 0 }],
      });
      seedGame(db, 'm-new', {
        patch: PATCH,
        createdAt: 2,
        purchases: [{ ts: 10_000, itemId: 3865, itemSlot: 0 }],
      });
      const rows = await aggregateItemBuilds(db, { tagsPath, fetchFn: mockFetch() });
      const row = findRow(
        rows,
        (r) => r.championId === 412 && r.myRole === 'SUPPORT' && r.itemId === 3865,
      );
      expect(row).toBeDefined();
      if (row === undefined) return;
      // Two games merged into one row; gamesW2 is the sum of squared weights,
      // strictly less than gamesW^2 for unequal weights.
      expect(row.gamesW2).toBeLessThan(row.gamesW * row.gamesW);
      expect(row.gamesW2).toBeGreaterThan(0);
    });
  });
});

// withDb is sync; async variant inlined here to keep the helper small.
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
