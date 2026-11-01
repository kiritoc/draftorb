import type Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, migrate } from './db';
import { exportJson, type ExportFile, type ExportResult } from './export';

describe('exportJson', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-export-'));
    process.env.DRAFTORB_PUBLIC_DIR = join(directory, 'public');
    const dbPath = join(directory, 'test.sqlite');
    db = openDb(dbPath);
    migrate(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.DRAFTORB_PUBLIC_DIR;
  });

  function seedMatch(patch = '16.21'): void {
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count)
       VALUES ('m1', 'euw1', ?, 420, 1800, 1, 6.5, 2)`,
    ).run(patch);
  }

  function seedRoleProb(
    rows: Array<{ championId: number; role: string; gamesW: number; gamesW2: number }>,
  ): void {
    const insert = db.prepare(
      `INSERT INTO role_prob (champion_id, role, games, games_w, games_w2, prob) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const write = db.transaction(() => {
      for (const row of rows) {
        insert.run(row.championId, row.role, 1, row.gamesW, row.gamesW2, 0.5);
      }
    });
    write.immediate();
  }

  function seedBaseline(
    rows: Array<{
      championId: number;
      myRole: string;
      rankBucket: string;
      gamesW: number;
      gamesW2: number;
      winsW: number;
      games: number;
    }>,
  ): void {
    const insert = db.prepare(
      `INSERT INTO baseline (champion_id, my_role, rank_bucket, wins_w, games_w, games_w2, games) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const write = db.transaction(() => {
      for (const row of rows) {
        insert.run(
          row.championId,
          row.myRole,
          row.rankBucket,
          row.winsW,
          row.gamesW,
          row.gamesW2,
          row.games,
        );
      }
    });
    write.immediate();
  }

  function seedPair(
    table: string,
    rows: Array<{
      championId: number;
      myRole: string;
      otherId: number;
      otherRole: string;
      rankBucket: string;
      gamesW: number;
      gamesW2: number;
      winsW: number;
    }>,
  ): void {
    const insert = db.prepare(
      `INSERT INTO ${table} (my_champion_id, my_role, other_champion_id, other_role, rank_bucket, wins_w, games_w, games_w2)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const write = db.transaction(() => {
      for (const row of rows) {
        insert.run(
          row.championId,
          row.myRole,
          row.otherId,
          row.otherRole,
          row.rankBucket,
          row.winsW,
          row.gamesW,
          row.gamesW2,
        );
      }
    });
    write.immediate();
  }

  function seedLaneVs(
    rows: Array<{
      championId: number;
      myRole: string;
      opp1Id: number;
      opp2Id: number | null;
      rankBucket: string;
      gamesW: number;
      gamesW2: number;
      winsW: number;
    }>,
  ): void {
    const insert = db.prepare(
      `INSERT INTO lane_vs (my_champion_id, my_role, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const write = db.transaction(() => {
      for (const row of rows) {
        insert.run(
          row.championId,
          row.myRole,
          row.opp1Id,
          row.opp2Id,
          row.rankBucket,
          row.winsW,
          row.gamesW,
          row.gamesW2,
        );
      }
    });
    write.immediate();
  }

  function seedLaneFull(
    rows: Array<{
      championId: number;
      myRole: string;
      partnerId: number | null;
      opp1Id: number;
      opp2Id: number | null;
      rankBucket: string;
      gamesW: number;
      gamesW2: number;
      winsW: number;
    }>,
  ): void {
    const insert = db.prepare(
      `INSERT INTO lane_full (my_champion_id, my_role, partner_id, opp1_id, opp2_id, rank_bucket, wins_w, games_w, games_w2)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const write = db.transaction(() => {
      for (const row of rows) {
        insert.run(
          row.championId,
          row.myRole,
          row.partnerId,
          row.opp1Id,
          row.opp2Id,
          row.rankBucket,
          row.winsW,
          row.gamesW,
          row.gamesW2,
        );
      }
    });
    write.immediate();
  }

  function seedRuneCtx(
    rows: Array<{
      championId: number;
      myRole: string;
      contextKey: string;
      contextLevel: number;
      perksHash: string;
      perksJson: string;
      gamesW: number;
      gamesW2: number;
      winsW: number;
      players: number;
    }>,
  ): void {
    const insert = db.prepare(
      `INSERT INTO rune_ctx (champion_id, my_role, rank_bucket, context_key, context_level, perks_hash, perks_json, wins_w, games_w, games_w2, players)
       VALUES (?, ?, 'IRON', ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const write = db.transaction(() => {
      for (const row of rows) {
        insert.run(
          row.championId,
          row.myRole,
          row.contextKey,
          row.contextLevel,
          row.perksHash,
          row.perksJson,
          row.winsW,
          row.gamesW,
          row.gamesW2,
          row.players,
        );
      }
    });
    write.immediate();
  }

  function readFile(relativePath: string): unknown {
    return JSON.parse(
      readFileSync(join(process.env.DRAFTORB_PUBLIC_DIR as string, '16.21', relativePath), 'utf8'),
    );
  }

  it('throws when the database has no patch to export', () => {
    expect(() => exportJson(db)).toThrow(/No patch found/);
  });

  it('exports role-prob.json as a sparse map filtered by n_eff', () => {
    seedMatch();
    // nEff(10, 10) = 10 >= exportMinGames(10) -> kept
    // nEff(5, 25) = 1 < 10 -> dropped
    seedRoleProb([
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10 },
      { championId: 412, role: 'MID', gamesW: 5, gamesW2: 25 },
      { championId: 26, role: 'SUPPORT', gamesW: 8, gamesW2: 8 },
    ]);
    const result = exportJson(db, { patch: '16.21' });
    const roleProb = readFile('role-prob.json') as Record<string, Record<string, number>>;
    expect(Object.keys(roleProb)).toEqual(['412']);
    expect(roleProb['412']).toEqual({ SUPPORT: 1 });
    expect(roleProb['26']).toBeUndefined();
    expect(roleProb['412']?.MID).toBeUndefined();
    expect(result.patch).toBe('16.21');
    expect(result.manifest.schemaVersion).toBe(2);
    expect(result.manifest.roles).toEqual(['SUPPORT']);
    expect(result.manifest.rankBuckets).toEqual([
      'IRON',
      'BRONZE',
      'SILVER',
      'GOLD',
      'PLATINUM',
      'EMERALD',
      'DIAMOND',
      'MASTER_PLUS',
    ]);
  });

  it('exports role-keyed tables as tuples filtered by n_eff', () => {
    seedMatch();
    seedBaseline([
      {
        championId: 412,
        myRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        games: 3,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        rankBucket: 'DIAMOND',
        gamesW: 4,
        gamesW2: 16,
        winsW: 2,
        games: 1,
      }, // nEff = 1 -> dropped
    ]);
    seedPair('pair_ally', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        otherId: 21,
        otherRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 7,
      },
    ]);
    seedLaneVs([
      {
        championId: 412,
        myRole: 'SUPPORT',
        opp1Id: 21,
        opp2Id: 26,
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 5,
      },
    ]);
    seedLaneFull([
      {
        championId: 412,
        myRole: 'SUPPORT',
        partnerId: 21,
        opp1Id: 26,
        opp2Id: 84,
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 5,
      },
    ]);

    const result: ExportResult = exportJson(db, { patch: '16.21' });

    const baseline = readFile('roles/SUPPORT/baseline.json') as [
      number,
      string,
      number,
      number,
      number,
      number,
    ][];
    expect(baseline).toEqual([[412, 'IRON', 6, 10, 10, 3]]);

    const ally = readFile('roles/SUPPORT/ally-pairs.json') as [
      number,
      number,
      string,
      string,
      number,
      number,
      number,
    ][];
    expect(ally).toEqual([[412, 21, 'SUPPORT', 'IRON', 7, 10, 10]]);

    const laneVs = readFile('roles/SUPPORT/lane-vs.json') as [
      number,
      number,
      number | null,
      string,
      number,
      number,
      number,
    ][];
    expect(laneVs).toEqual([[412, 21, 26, 'IRON', 5, 10, 10]]);

    const laneFull = readFile('roles/SUPPORT/lane-full.json') as [
      number,
      number | null,
      number,
      number | null,
      string,
      number,
      number,
      number,
    ][];
    expect(laneFull).toEqual([[412, 21, 26, 84, 'IRON', 5, 10, 10]]);

    expect(result.files.map((f: ExportFile) => f.relativePath)).toContain(
      'roles/SUPPORT/baseline.json',
    );
    expect(result.files.map((f: ExportFile) => f.relativePath)).toContain(
      'roles/SUPPORT/ally-pairs.json',
    );
    expect(result.files.map((f: ExportFile) => f.relativePath)).toContain(
      'roles/SUPPORT/lane-vs.json',
    );
    expect(result.files.map((f: ExportFile) => f.relativePath)).toContain(
      'roles/SUPPORT/lane-full.json',
    );
  });

  it('exports runes parsed from perks_json', () => {
    seedMatch();
    seedRuneCtx([
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'abc',
        perksJson: JSON.stringify({
          statPerks: { offense: 5008, defense: 5005, flex: 5008 },
          styles: [
            {
              description: 'primaryStyle',
              style: 8400,
              selections: [{ perk: 8439 }, { perk: 8453 }, { perk: 8465 }, { perk: 8473 }],
            },
            { description: 'subStyle', style: 8100, selections: [{ perk: 9111 }, { perk: 9104 }] },
          ],
        }),
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 2,
      },
    ]);

    exportJson(db, { patch: '16.21' });
    const runes = readFile('roles/SUPPORT/runes/412.json') as {
      championId: number;
      myRole: string;
      contexts: Array<{ contextKey: string; contextLevel: number; pages: unknown[] }>;
    };
    expect(runes.championId).toBe(412);
    expect(runes.myRole).toBe('SUPPORT');
    expect(runes.contexts).toHaveLength(1);
    expect(runes.contexts[0]!.contextKey).toBe('lane:SUPPORT|ADC');
    expect(runes.contexts[0]!.contextLevel).toBe(1);
    const page = runes.contexts[0]!.pages[0]!;
    expect(page).toMatchObject({
      primaryStyleId: 8400,
      subStyleId: 8100,
      keystoneId: 8439,
      selectedPerkIds: [8439, 8453, 8465, 8473, 9111, 9104],
      statShardIds: [5008, 5005, 5008],
      winsW: 6,
      gamesW: 10,
      gamesW2: 10,
      winrate: 0.6,
    });
  });

  it('skips rune rows with unparseable perks_json instead of aborting', () => {
    seedMatch();
    seedRuneCtx([
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'bad',
        perksJson: 'not json',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 2,
      },
    ]);

    const result = exportJson(db, { patch: '16.21' });
    expect(result.files.map((f: ExportFile) => f.relativePath)).not.toContain(
      'roles/SUPPORT/runes/412.json',
    );
  });

  it('rejects a malformed patch', () => {
    seedMatch();
    expect(() => exportJson(db, { patch: '16' })).toThrow(/Invalid patch/);
  });
});
