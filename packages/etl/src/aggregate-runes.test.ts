import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, nEff } from '@draftorb/engine';

import { openDb, migrate } from './db';
import {
  aggregateRunesByContext,
  canonicalPerksJson,
  damageMix,
  type RuneCtxRow,
} from './aggregate-runes';

const PATCH_16_20 = '16.20';
const PATCH_16_21 = '16.21';

interface Participant {
  teamId: number;
  championId: number;
  role: string;
  win: number;
  puuid: string;
  championGames: number;
  perksJson: string;
}

// Me = Soraka (412) SUPPORT on team 100, allied ADC = Miss Fortune (21),
// enemy support = Maokai (266), enemy ADC = Ashe (22).
const baseParticipants = (overrides: Partial<Participant>[] = []): Participant[] => {
  const defaults: Record<string, Participant> = {
    '100:412': {
      teamId: 100,
      championId: 412,
      role: 'SUPPORT',
      win: 1,
      puuid: 'p-me',
      championGames: 100,
      perksJson: '{"keystone":8439,"primary":8400,"sub":8300}',
    },
    '100:21': {
      teamId: 100,
      championId: 21,
      role: 'ADC',
      win: 1,
      puuid: 'p-adc',
      championGames: 100,
      perksJson: '{"keystone":8112,"primary":8000,"sub":8100}',
    },
    '100:14': {
      teamId: 100,
      championId: 14,
      role: 'TOP',
      win: 1,
      puuid: 'p-top',
      championGames: 100,
      perksJson: '{"keystone":8439,"primary":8400,"sub":8300}',
    },
    '100:64': {
      teamId: 100,
      championId: 64,
      role: 'JUNGLE',
      win: 1,
      puuid: 'p-jgl',
      championGames: 100,
      perksJson: '{"keystone":8112,"primary":8000,"sub":8100}',
    },
    '100:157': {
      teamId: 100,
      championId: 157,
      role: 'MID',
      win: 1,
      puuid: 'p-mid',
      championGames: 100,
      perksJson: '{"keystone":8439,"primary":8400,"sub":8300}',
    },
    '200:266': {
      teamId: 200,
      championId: 266,
      role: 'SUPPORT',
      win: 0,
      puuid: 'p-ensup',
      championGames: 100,
      perksJson: '{"keystone":8112,"primary":8000,"sub":8100}',
    },
    '200:22': {
      teamId: 200,
      championId: 22,
      role: 'ADC',
      win: 0,
      puuid: 'p-enadc',
      championGames: 100,
      perksJson: '{"keystone":8439,"primary":8400,"sub":8300}',
    },
    '200:80': {
      teamId: 200,
      championId: 80,
      role: 'TOP',
      win: 0,
      puuid: 'p-entop',
      championGames: 100,
      perksJson: '{"keystone":8112,"primary":8000,"sub":8100}',
    },
    '200:59': {
      teamId: 200,
      championId: 59,
      role: 'JUNGLE',
      win: 0,
      puuid: 'p-enjgl',
      championGames: 100,
      perksJson: '{"keystone":8439,"primary":8400,"sub":8300}',
    },
    '200:12': {
      teamId: 200,
      championId: 12,
      role: 'MID',
      win: 0,
      puuid: 'p-enmid',
      championGames: 100,
      perksJson: '{"keystone":8112,"primary":8000,"sub":8100}',
    },
  };
  return Object.values(
    Object.fromEntries([
      ...Object.entries(defaults),
      ...overrides.map((o) => [
        `${o.teamId}:${o.championId}`,
        { ...defaults[`${o.teamId}:${o.championId}`], ...o } as Participant,
      ]),
    ]),
  );
};

let matchIndex = 0;

export function seedMatch(
  db: ReturnType<typeof openDb>,
  {
    patch = PATCH_16_21,
    rankKnownCount = 2,
    avgRankScore = 6.5,
    participants = baseParticipants(),
  }: {
    patch?: string;
    rankKnownCount?: number;
    avgRankScore?: number;
    participants?: Participant[];
  } = {},
): string {
  const matchId = `m${++matchIndex}`;
  db.prepare(
    `INSERT INTO matches (
      match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
    ) VALUES (?, 'euw1', ?, 420, 1800, 1, ?, ?)`,
  ).run(matchId, patch, avgRankScore, rankKnownCount);
  const insertParticipant = db.prepare(
    `INSERT INTO participants (
      match_id, puuid, team_id, champion_id, role, win, rank_score,
      champion_games, mastery_points, is_expert, keystone, primary_style,
      sub_style, perks_json, items_json, kills, deaths, assists
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 8439, 8400, 8300, ?, '[]', 0, 0, 0)`,
  );
  for (const p of participants) {
    insertParticipant.run(
      matchId,
      p.puuid,
      p.teamId,
      p.championId,
      p.role,
      p.win,
      avgRankScore,
      p.championGames,
      p.perksJson,
    );
  }
  return matchId;
}

export function requireRow(
  rows: RuneCtxRow[],
  championId: number,
  myRole: string,
  contextKey: string,
): RuneCtxRow {
  const row = rows.find(
    (r) =>
      r.championId === championId &&
      r.myRole === myRole &&
      r.contextKey === contextKey &&
      r.rankBucket === 'DIAMOND',
  );
  if (!row) {
    throw new Error(
      `expected rune_ctx row for champion ${championId} role ${myRole} context ${contextKey}`,
    );
  }
  return row;
}

/** Most specific lane row (all `contextSlots` slots) for a champion/role. */
export function requireFullLaneRow(
  rows: RuneCtxRow[],
  championId: number,
  myRole: string,
): RuneCtxRow {
  const lane = rows
    .filter(
      (r) =>
        r.championId === championId &&
        r.myRole === myRole &&
        r.rankBucket === 'DIAMOND' &&
        r.contextKey.startsWith('lane:'),
    )
    .sort((a, b) => b.contextKey.split(',').length - a.contextKey.split(',').length)[0];
  if (!lane) throw new Error(`expected lane row for champion ${championId} role ${myRole}`);
  return lane;
}

export function withFreshDb(run: (dbPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-runes-'));
  const dbPath = join(directory, 'test.sqlite');
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  process.env.DRAFTORB_DB_PATH = dbPath;
  try {
    run(dbPath);
  } finally {
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

export function withSeededDb(
  patches: Array<{ patch: string; rankKnownCount?: number }>,
  run: (db: ReturnType<typeof openDb>) => void,
): void {
  withFreshDb((dbPath) => {
    const db = openDb(dbPath);
    try {
      migrate(db);
      for (const p of patches) {
        seedMatch(db, { patch: p.patch, rankKnownCount: p.rankKnownCount ?? 2 });
      }
      run(db);
    } finally {
      db.close();
    }
  });
}

describe('aggregateRunesByContext', () => {
  it('accumulates a lane-context rune row for a support game', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const rows = aggregateRunesByContext(db);
      // Me = Soraka 412 SUPPORT won. Context = ally ADC 21 + enemy support 266 + enemy ADC 22.
      const lane = requireFullLaneRow(rows, 412, 'SUPPORT');
      expect(lane.contextKey.slice('lane:'.length).split(',').sort()).toEqual([
        'a.ADC:21',
        'e.ADC:22',
        'e.SUPPORT:266',
      ]);
      expect(lane.contextLevel).toBe(1);
      expect(lane.winsW).toBeCloseTo(1);
      expect(lane.gamesW).toBeCloseTo(1);
      expect(lane.gamesW2).toBeCloseTo(1);
      expect(lane.players).toBe(1);
      expect(lane.perksJson).toBe('{"keystone":8439,"primary":8400,"sub":8300}');
    });
  });

  it('produces all three back-off context levels (lane, damagemix, global)', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const rows = aggregateRunesByContext(db);
      const supportRows = rows.filter(
        (r) => r.championId === 412 && r.myRole === 'SUPPORT' && r.rankBucket === 'DIAMOND',
      );
      const keys = new Set(supportRows.map((r) => r.contextKey));
      // Lane back-off: 3, 2 and 1 slots (least influential dropped first).
      const laneKeys = [...keys].filter((k) => k.startsWith('lane:'));
      expect(laneKeys.map((k) => k.split(',').length).sort()).toEqual([1, 2, 3]);
      expect([...keys].some((k) => k.startsWith('damagemix:'))).toBe(true);
      expect(keys.has('global')).toBe(true);
      const levels = [...supportRows.map((r) => r.contextLevel)].sort((a, b) => a - b);
      // Lane levels increase as slots drop: 3-slot=1, 2-slot=2, 1-slot=3, then damage mix=4, global=5.
      expect(levels).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('applies expertWeight per user rank bucket (below excluded, above boosted)', () => {
    // Seeded games are DIAMOND (avg_rank_score 6.5, bucket index 6).
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const global = aggregateRunesByContext(db).filter(
        (r) => r.championId === 412 && r.myRole === 'SUPPORT' && r.contextKey === 'global',
      );
      const byBucket = new Map(global.map((r) => [r.rankBucket, r.gamesW]));
      expect(byBucket.has('MASTER_PLUS')).toBe(false);
      expect(byBucket.get('DIAMOND')).toBeCloseTo(1);
      expect(byBucket.get('EMERALD')).toBeCloseTo(1 + DEFAULT_CONFIG.alpha);
      expect(byBucket.get('IRON')).toBeCloseTo(DEFAULT_CONFIG.wMax);
    });
  });

  it('accepts mastery-qualified participants below minChampGames', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        seedMatch(db, {
          participants: baseParticipants([{ teamId: 100, championId: 412, championGames: 5 }]),
        });
        const setMastery = db.prepare('UPDATE participants SET mastery_points = ? WHERE puuid = ?');
        setMastery.run(DEFAULT_CONFIG.minMasteryPoints, 'p-me');
        seedMatch(db, {
          participants: baseParticipants([
            { teamId: 100, championId: 412, championGames: 5, puuid: 'p-low' },
          ]),
        });
        setMastery.run(DEFAULT_CONFIG.minMasteryPoints - 1, 'p-low');
        const row = requireRow(aggregateRunesByContext(db), 412, 'SUPPORT', 'global');
        expect(row.players).toBe(1);
        expect(row.gamesW).toBeCloseTo(1);
      } finally {
        db.close();
      }
    });
  });

  it('assigns lane levels from slot count alone, for every role', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const lanes = aggregateRunesByContext(db).filter((r) => r.contextKey.startsWith('lane:'));
      expect(lanes.length).toBeGreaterThan(0);
      for (const r of lanes) {
        expect(r.contextLevel).toBe(4 - r.contextKey.split(',').length);
      }
    });
  });

  it('applies the experts rule: champion_games below minChampGames is excluded', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        seedMatch(db, {
          patch: PATCH_16_21,
          participants: baseParticipants([{ teamId: 100, championId: 412, championGames: 10 }]),
        });
        const rows = aggregateRunesByContext(db);
        expect(rows.find((r) => r.championId === 412 && r.myRole === 'SUPPORT')).toBeUndefined();
      } finally {
        db.close();
      }
    });
  });

  it('applies recency decay across patches', () => {
    withSeededDb(
      [
        { patch: PATCH_16_20, rankKnownCount: 2 },
        { patch: PATCH_16_21, rankKnownCount: 2 },
      ],
      (db) => {
        const rows = aggregateRunesByContext(db);
        const lane = requireFullLaneRow(rows, 412, 'SUPPORT');
        // 16.20 (index 0, recency 0.85) + 16.21 (index 1, recency 1.0); me wins both.
        expect(lane.gamesW).toBeCloseTo(1.85);
        expect(lane.winsW).toBeCloseTo(1.85);
        expect(lane.gamesW2).toBeCloseTo(0.85 ** 2 + 1);
        // Same puuid ('p-me') plays both matches, so distinct players = 1.
        expect(lane.players).toBe(1);
        expect(nEff(lane.gamesW, lane.gamesW2)).toBeCloseTo(1.9871);
        // n_eff is below the raw game count (2) when weights are uneven.
        expect(nEff(lane.gamesW, lane.gamesW2)).toBeLessThan(2);
      },
    );
  });

  it('down-weights games where only the seed rank is known', () => {
    withSeededDb([{ patch: PATCH_16_21, rankKnownCount: 1 }], (db) => {
      const lane = requireFullLaneRow(aggregateRunesByContext(db), 412, 'SUPPORT');
      expect(lane.gamesW).toBeCloseTo(DEFAULT_CONFIG.unknownRankFactor);
      expect(lane.gamesW2).toBeCloseTo(DEFAULT_CONFIG.unknownRankFactor ** 2);
    });
  });

  it('is idempotent across reruns', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        seedMatch(db, { patch: PATCH_16_20 });
        seedMatch(db, { patch: PATCH_16_21 });
        const first = aggregateRunesByContext(db);
        const second = aggregateRunesByContext(db);
        expect(second).toEqual(first);
        expect(db.prepare('SELECT COUNT(*) AS count FROM rune_ctx').get()).toMatchObject({
          count: first.length,
        });
      } finally {
        db.close();
      }
    });
  });

  it('preserves existing rows when the snapshot predates all stored matches', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const before = aggregateRunesByContext(db);
      expect(before.length).toBeGreaterThan(0);
      expect(aggregateRunesByContext(db, { patch: '16.1' })).toEqual([]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM rune_ctx').get()).toMatchObject({
        count: before.length,
      });
    });
  });

  it('excludes matches newer than the snapshot patch', () => {
    withSeededDb(
      [
        { patch: PATCH_16_20, rankKnownCount: 2 },
        { patch: PATCH_16_21, rankKnownCount: 2 },
      ],
      (db) => {
        const rows = aggregateRunesByContext(db, { patch: PATCH_16_20 });
        // Only 16.20 contributes: one game, weight 1.
        const lane = requireFullLaneRow(rows, 412, 'SUPPORT');
        expect(lane.gamesW).toBeCloseTo(1);
        expect(lane.players).toBe(1);
      },
    );
  });

  it('rejects a malformed patch and leaves the table untouched', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const before = aggregateRunesByContext(db);
      expect(() => aggregateRunesByContext(db, { patch: '16' })).toThrow(/Invalid patch/);
      expect(db.prepare('SELECT COUNT(*) AS count FROM rune_ctx').get()).toMatchObject({
        count: before.length,
      });
    });
  });

  it('excludes experts who only qualify thanks to games after the snapshot', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        const threshold = DEFAULT_CONFIG.minChampGames;
        const participants = baseParticipants([
          { teamId: 100, championId: 412, championGames: threshold },
        ]);
        seedMatch(db, { patch: PATCH_16_20, participants });
        seedMatch(db, { patch: PATCH_16_21, participants });
        const rows = aggregateRunesByContext(db, { patch: PATCH_16_20 });
        expect(rows.find((r) => r.championId === 412 && r.myRole === 'SUPPORT')).toBeUndefined();
      } finally {
        db.close();
      }
    });
  });

  it('merges identical rune pages whose var stats differ', () => {
    const page = (var1: number): string =>
      JSON.stringify({
        statPerks: { defense: 5001, flex: 5008, offense: 5005 },
        styles: [
          { description: 'primaryStyle', style: 8400, selections: [{ perk: 8439, var1 }] },
          { description: 'subStyle', style: 8300, selections: [{ perk: 8345, var1: 0 }] },
        ],
      });
    expect(canonicalPerksJson(page(500))).toBe(canonicalPerksJson(page(300)));
  });

  it('ignores untagged champions in the damage mix', () => {
    const tags = new Map([
      [1, 'AD'],
      [2, 'AD'],
    ]);
    expect(damageMix([1, 2, 999], tags)).toBe('AD');
    expect(damageMix([999], tags)).toBe('mixed');
  });

  it('treats MIXED damage as both AD and AP', () => {
    const tags = new Map([[1, 'MIXED']]);
    expect(damageMix([1], tags)).toBe('mixed');
    const tagsAdMixed = new Map([
      [1, 'AD'],
      [2, 'MIXED'],
    ]);
    expect(damageMix([1, 2], tagsAdMixed)).toBe('mixed');
    const tagsApMixed = new Map([
      [1, 'AP'],
      [2, 'MIXED'],
    ]);
    expect(damageMix([1, 2], tagsApMixed)).toBe('mixed');
  });

  it('ignores NONE damage champions', () => {
    const tags = new Map([
      [1, 'NONE'],
      [2, 'NONE'],
    ]);
    expect(damageMix([1, 2], tags)).toBe('mixed');
    const tagsAdNone = new Map([
      [1, 'AD'],
      [2, 'NONE'],
    ]);
    expect(damageMix([1, 2], tagsAdNone)).toBe('AD');
    const tagsApNone = new Map([
      [1, 'AP'],
      [2, 'NONE'],
    ]);
    expect(damageMix([1, 2], tagsApNone)).toBe('AP');
  });

  it('leaves rune_ctx empty when there are no participants', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        const rows = aggregateRunesByContext(db);
        expect(rows).toEqual([]);
        expect(db.prepare('SELECT COUNT(*) AS count FROM rune_ctx').get()).toMatchObject({
          count: 0,
        });
      } finally {
        db.close();
      }
    });
  });
});

describe('champion tags loading (B-047)', () => {
  it('throws when the tags file does not exist', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      expect(() =>
        aggregateRunesByContext(db, { tagsPath: '/nonexistent/champion-tags.json' }),
      ).toThrow(/Cannot load champion tags from \/nonexistent\/champion-tags\.json/);
    });
  });

  it('throws when the tags file is not valid JSON', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const directory = mkdtempSync(join(tmpdir(), 'draftorb-tags-'));
      try {
        const tagsPath = join(directory, 'champion-tags.json');
        writeFileSync(tagsPath, '{not json', 'utf-8');
        expect(() => aggregateRunesByContext(db, { tagsPath })).toThrow(
          /Cannot load champion tags/,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  it('throws when the tags file fails schema validation', () => {
    withSeededDb([{ patch: PATCH_16_21 }], (db) => {
      const directory = mkdtempSync(join(tmpdir(), 'draftorb-tags-'));
      try {
        const tagsPath = join(directory, 'champion-tags.json');
        writeFileSync(tagsPath, JSON.stringify({ '1': { damageType: 'BOGUS' } }), 'utf-8');
        expect(() => aggregateRunesByContext(db, { tagsPath })).toThrow(
          /Cannot load champion tags/,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
