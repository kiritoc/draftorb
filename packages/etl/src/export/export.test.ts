import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from '../db';
import { exportJson, type ExportOptions, type ExportResult } from './index';
import {
  allyPairTableSchema,
  baselineTableSchema,
  championRoleProbabilitiesSchema,
  enemyPairTableSchema,
  itemBuildExportSchema,
  laneFullTableSchema,
  laneVsTableSchema,
  manifestSchema,
  runeExportSchema,
} from '@draftorb/shared';
import {
  seedMatch,
  seedRoleProb,
  seedBaseline,
  seedPair,
  seedLaneVs,
  seedLaneFull,
  seedRuneCtx,
  seedItemBuild,
  validPerksJson,
} from './export.fixtures';

const PATCH = '16.21';
const FIXED_NOW = new Date('2026-11-02T21:00:00Z');

describe('exportJson', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-export-'));
    process.env.DRAFTORB_PUBLIC_DIR = join(directory, 'public');
    db = openDb(join(directory, 'test.sqlite'));
    migrate(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.DRAFTORB_PUBLIC_DIR;
  });

  function readFile<T>(relativePath: string): T {
    return JSON.parse(
      readFileSync(join(process.env.DRAFTORB_PUBLIC_DIR as string, PATCH, relativePath), 'utf8'),
    ) as T;
  }

  function exportOnce(options: Parameters<typeof exportJson>[1] = {}): ExportResult {
    return exportJson(db, { patch: PATCH, now: () => FIXED_NOW, ...options });
  }

  it('throws when the database has no patch to export', () => {
    expect(() => exportJson(db)).toThrow(/No patch found/);
  });

  it('throws when exportMinGames > minGames (C6)', () => {
    const badConfig = { exportMinGames: 30, minGames: 25 } as ExportOptions['config'];
    expect(() => exportJson(db, { patch: PATCH, config: badConfig })).toThrow(
      /must be <= minGames/,
    );
  });

  it('exports role-prob.json from stored prob, renormalizing survivors to sum to 1 (412: SUPPORT kept, MID dropped) (B1)', () => {
    seedMatch(db);
    seedRoleProb(db, [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 0.8 }, // kept
      { championId: 412, role: 'MID', gamesW: 5, gamesW2: 25, prob: 0.2 }, // nEff=1 < 10 -> dropped
      { championId: 26, role: 'SUPPORT', gamesW: 8, gamesW2: 8, prob: 0.5 }, // nEff=8 < 10 -> dropped
    ]);
    const result = exportOnce();
    const roleProb = readFile('role-prob.json') as Record<string, Record<string, number>>;
    expect(Object.keys(roleProb)).toEqual(['412']);
    expect(roleProb['412']).toEqual({ SUPPORT: 1 });
    expect(roleProb['26']).toBeUndefined();
    expect(roleProb['412']?.MID).toBeUndefined();
    expect(result.patch).toBe(PATCH);
    expect(result.manifest.schemaVersion).toBe(2);
  });

  it('keeps multiple surviving roles with stored probs already summing to 1 (B1)', () => {
    seedMatch(db);
    seedRoleProb(db, [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 0.75 },
      { championId: 412, role: 'MID', gamesW: 10, gamesW2: 10, prob: 0.25 }, // nEff=10 -> kept
    ]);
    exportOnce();
    const roleProb = readFile('role-prob.json') as Record<string, Record<string, number>>;
    expect(roleProb['412']).toEqual({ SUPPORT: 0.75, MID: 0.25 });
  });

  it('exports role-keyed tables as tuples filtered by n_eff (E1 exact enemy-pairs)', () => {
    seedMatch(db);
    seedBaseline(db, [
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
      }, // dropped
      {
        championId: 412,
        myRole: 'MID',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        games: 3,
      }, // non-SUPPORT excluded
    ]);
    seedPair(db, 'pair_ally', [
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
      {
        championId: 412,
        myRole: 'MID',
        otherId: 21,
        otherRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 7,
      }, // excluded
    ]);
    seedPair(db, 'pair_enemy', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        otherId: 22,
        otherRole: 'ADC',
        rankBucket: 'IRON',
        gamesW: 3,
        gamesW2: 9,
        winsW: 1,
      }, // nEff=1 -> dropped (E4)
      {
        championId: 412,
        myRole: 'SUPPORT',
        otherId: 23,
        otherRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 8,
      },
    ]);
    seedLaneVs(db, [
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
      {
        championId: 412,
        myRole: 'SUPPORT',
        opp1Id: 21,
        opp2Id: null,
        rankBucket: 'IRON',
        gamesW: 2,
        gamesW2: 4,
        winsW: 1,
      }, // dropped (E4)
    ]);
    seedLaneFull(db, [
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
      {
        championId: 412,
        myRole: 'SUPPORT',
        partnerId: null,
        opp1Id: 26,
        opp2Id: null,
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 5,
      }, // kept (nullable partner/opp2)
    ]);

    exportOnce();

    const baseline = readFile('roles/SUPPORT/baseline.json') as [
      number,
      string,
      number,
      number,
      number,
      number?,
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

    // E1: exact enemy-pairs tuple, dropped row excluded.
    const enemy = readFile('roles/SUPPORT/enemy-pairs.json') as [
      number,
      number,
      string,
      string,
      number,
      number,
      number,
    ][];
    expect(enemy).toEqual([[412, 23, 'SUPPORT', 'IRON', 8, 10, 10]]);

    // E3: lane id order preserved — SUPPORT: opp1=enemy SUPPORT(21), opp2=enemy ADC(26).
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

    // E3: nullable partner / opp2 case (lane-full). SQLite sorts NULL first.
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
    expect(laneFull).toEqual([
      [412, null, 26, null, 'IRON', 5, 10, 10],
      [412, 21, 26, 84, 'IRON', 5, 10, 10],
    ]);
  });

  it('excludes non-SUPPORT rows from every role-keyed file and from runes/builds (E2)', () => {
    seedMatch(db);
    seedBaseline(db, [
      {
        championId: 412,
        myRole: 'MID',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        games: 3,
      },
    ]);
    seedRuneCtx(db, [
      {
        championId: 412,
        myRole: 'MID',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'h',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 2,
      },
    ]);
    seedItemBuild(db, [
      {
        championId: 412,
        myRole: 'MID',
        slotIdx: 0,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: '',
        itemId: 3340,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
      },
    ]);
    seedRoleProb(db, [{ championId: 412, role: 'MID', gamesW: 10, gamesW2: 10, prob: 1 }]);

    const result = exportOnce();
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/MID/baseline.json');
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/MID/runes/412.json');
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/MID/builds/412.json');
    // role-prob.json is global (not role-keyed), so the MID row survives the gate there.
    expect(readFile('role-prob.json')).toEqual({ '412': { MID: 1 } });
  });

  it('exports runes with computed pickShare (B4), skips invalid pages, groups by (championId, myRole) (B6)', () => {
    seedMatch(db);
    seedRuneCtx(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'a',
        perksJson: validPerksJson,
        gamesW: 15,
        gamesW2: 15,
        winsW: 6,
        players: 2,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'b',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 4,
        players: 1,
      },
      {
        championId: 412,
        myRole: 'MID',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'c',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'd',
        perksJson: 'not json',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      }, // unparseable
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'e',
        perksJson: JSON.stringify({
          statPerks: {},
          styles: [
            { style: 0, selections: [] },
            { style: 0, selections: [] },
          ],
        }),
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      }, // primaryStyleId <= 0
    ]);
    const result = exportOnce({ roles: ['SUPPORT', 'MID'] as const });
    const runes = readFile('roles/SUPPORT/runes/412.json') as {
      championId: number;
      myRole: string;
      contexts: Array<{
        contextKey: string;
        contextLevel: number;
        pages: Array<{ pickShare: number; gamesW: number }>;
      }>;
    };
    expect(runes.championId).toBe(412);
    expect(runes.myRole).toBe('SUPPORT');
    expect(runes.contexts).toHaveLength(1);
    const context = runes.contexts[0];
    if (context === undefined) throw new Error('missing context');
    const pages = context.pages;
    expect(pages).toHaveLength(2);
    // B4: pickShare = gamesW / sum(gamesW in context) = 6/10 and 4/10.
    const first = pages[0];
    const second = pages[1];
    if (first === undefined || second === undefined) throw new Error('missing pages');
    expect(first.pickShare).toBe(0.6);
    expect(second.pickShare).toBe(0.4);
    expect(first.gamesW).toBe(15);
    expect(second.gamesW).toBe(10);
    // C3: skipped count non-zero (rows d and e are unparseable/invalid).
    expect(result.skippedRunePages).toBeGreaterThan(0);
    // B6: MID role file exists under roles/MID (separate group).
    expect(result.files.map((f) => f.relativePath)).toContain('roles/MID/runes/412.json');
  });

  it('C3: an all-invalid champion produces no rune file and a non-zero skipped count', () => {
    seedMatch(db);
    seedRuneCtx(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'bad1',
        perksJson: 'not json',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: 5,
        perksHash: 'bad2',
        perksJson: JSON.stringify({
          statPerks: {},
          styles: [
            { style: 0, selections: [] },
            { style: 0, selections: [] },
          ],
        }),
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      }, // primaryStyleId <= 0
    ]);
    const result = exportOnce();
    expect(result.skippedRunePages).toBe(2);
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/SUPPORT/runes/412.json');
  });

  it('exports builds with computed pickShare, no | split corruption, laneKey absent when null (B5)', () => {
    seedMatch(db);
    seedItemBuild(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        slotIdx: 1,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: 'lane:SUPPORT|ADC',
        itemId: 3340,
        gamesW: 15,
        gamesW2: 15,
        winsW: 6,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        slotIdx: 1,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: 'lane:SUPPORT|ADC',
        itemId: 3047,
        gamesW: 10,
        gamesW2: 10,
        winsW: 4,
      },
      {
        championId: 412,
        myRole: 'SUPPORT',
        slotIdx: 0,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: '',
        itemId: 3340,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
      }, // laneKey absent (DB stores '' sentinel)
    ]);
    exportOnce();
    const builds = readFile('roles/SUPPORT/builds/412.json') as {
      championId: number;
      myRole: string;
      contexts: Array<{
        slotIdx: number;
        laneKey?: string;
        items: Array<{ itemId: number; pickShare: number }>;
      }>;
    };
    const laneCtx = builds.contexts.find((c) => c.laneKey === 'lane:SUPPORT|ADC');
    if (laneCtx === undefined) throw new Error('missing lane context');
    expect(laneCtx.items.map((i) => i.itemId).sort((a, b) => a - b)).toEqual([3047, 3340]);
    // B4: pickShare within context = 6/10 and 4/10.
    expect(laneCtx.items.find((i) => i.itemId === 3340)?.pickShare).toBe(0.6);
    expect(laneCtx.items.find((i) => i.itemId === 3047)?.pickShare).toBe(0.4);
    const startCtx = builds.contexts.find((c) => c.slotIdx === 0);
    if (startCtx === undefined) throw new Error('missing start context');
    expect(startCtx.laneKey).toBeUndefined(); // null -> absent, not ''
    const firstItem = startCtx.items[0];
    if (firstItem === undefined) throw new Error('missing first item');
    expect(firstItem.itemId).toBe(3340);
  });

  it('exposes warnings in ExportResult and logs them when a file exceeds maxFileBytes (B3)', () => {
    seedMatch(db);
    seedRoleProb(db, [{ championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 }]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = exportOnce({ maxFileBytes: 1 }); // force every file over budget
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('gzip size'))).toBe(true);
    logSpy.mockRestore();
  });

  it('manifest: exact file set, sha256 per entry, schemaVersion, roles, rankBuckets, patch, generatedAt (B2, E5)', () => {
    seedMatch(db);
    seedRoleProb(db, [{ championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 }]);
    seedBaseline(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        games: 3,
      },
    ]);
    const result = exportOnce();
    const manifest = result.manifest;
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.roles).toEqual(['SUPPORT']);
    expect(manifest.rankBuckets).toEqual([
      'IRON',
      'BRONZE',
      'SILVER',
      'GOLD',
      'PLATINUM',
      'EMERALD',
      'DIAMOND',
      'MASTER_PLUS',
    ]);
    expect(manifest.patch).toBe(PATCH);
    expect(manifest.generatedAt).toBe(FIXED_NOW.toISOString());
    const paths = manifest.files.map((f) => f.path).sort();
    // The manifest is not listed in its own `files`.
    expect(paths).toEqual([
      'role-prob.json',
      'roles/SUPPORT/ally-pairs.json',
      'roles/SUPPORT/baseline.json',
      'roles/SUPPORT/enemy-pairs.json',
      'roles/SUPPORT/lane-full.json',
      'roles/SUPPORT/lane-vs.json',
    ]);
    for (const file of manifest.files) {
      expect(typeof file.sha256).toBe('string');
      if (typeof file.sha256 !== 'string') throw new Error('missing sha256');
      expect(file.sha256.length).toBe(64);
      // B2: recompute hash from disk and compare.
      const disk = readFileSync(
        join(process.env.DRAFTORB_PUBLIC_DIR as string, PATCH, file.path),
        'utf8',
      );
      expect(createHash('sha256').update(disk, 'utf8').digest('hex')).toBe(file.sha256);
    }
  });

  it('schema round-trip: every exported file parses with the shared zod schemas (E6)', () => {
    seedMatch(db);
    seedRoleProb(db, [{ championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 }]);
    seedBaseline(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        games: 3,
      },
    ]);
    seedPair(db, 'pair_ally', [
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
    seedPair(db, 'pair_enemy', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        otherId: 22,
        otherRole: 'ADC',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 5,
      },
    ]);
    seedLaneVs(db, [
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
    seedLaneFull(db, [
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
    seedRuneCtx(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'lane:SUPPORT|ADC',
        contextLevel: 1,
        perksHash: 'h',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 2,
      },
    ]);
    seedItemBuild(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        slotIdx: 1,
        timeBucket: '0-5',
        stateBucket: 'even',
        profileKey: 'AD',
        laneKey: 'lane:SUPPORT|ADC',
        itemId: 3340,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
      },
    ]);

    exportOnce();
    const base = join(process.env.DRAFTORB_PUBLIC_DIR as string, PATCH);
    // Manifest.
    manifestSchema.parse(JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')));
    // Tuples.
    baselineTableSchema.parse(readFile('roles/SUPPORT/baseline.json'));
    allyPairTableSchema.parse(readFile('roles/SUPPORT/ally-pairs.json'));
    enemyPairTableSchema.parse(readFile('roles/SUPPORT/enemy-pairs.json'));
    laneVsTableSchema.parse(readFile('roles/SUPPORT/lane-vs.json'));
    laneFullTableSchema.parse(readFile('roles/SUPPORT/lane-full.json'));
    // Role-prob (sparse map summing to 1).
    championRoleProbabilitiesSchema.parse(readFile('role-prob.json'));
    // Rune + build.
    runeExportSchema.parse(readFile('roles/SUPPORT/runes/412.json'));
    itemBuildExportSchema.parse(readFile('roles/SUPPORT/builds/412.json'));
  });

  it('determinism: two exports into separate dirs are byte-identical (C1)', () => {
    seedMatch(db);
    seedRoleProb(db, [{ championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 }]);
    seedBaseline(db, [
      {
        championId: 412,
        myRole: 'SUPPORT',
        rankBucket: 'IRON',
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        games: 3,
      },
    ]);
    const dirA = join(directory, 'public-a');
    const dirB = join(directory, 'public-b');
    process.env.DRAFTORB_PUBLIC_DIR = dirA;
    mkdirSync(dirA, { recursive: true });
    const resultA = exportJson(db, { patch: PATCH, now: () => FIXED_NOW });
    process.env.DRAFTORB_PUBLIC_DIR = dirB;
    mkdirSync(dirB, { recursive: true });
    const resultB = exportJson(db, { patch: PATCH, now: () => FIXED_NOW });
    process.env.DRAFTORB_PUBLIC_DIR = join(directory, 'public');

    const listFiles = (root: string): string[] =>
      readdirSync(root, { recursive: true })
        .map(String)
        .filter((rel) => statSync(join(root, rel)).isFile())
        .sort();
    const filesA = listFiles(join(dirA, PATCH));
    const filesB = listFiles(join(dirB, PATCH));
    expect(filesA).toEqual(filesB);
    for (const rel of filesA) {
      const a = readFileSync(join(dirA, PATCH, rel), 'utf8');
      const b = readFileSync(join(dirB, PATCH, rel), 'utf8');
      expect(a).toBe(b);
    }
    expect(resultA.manifest.generatedAt).toBe(resultB.manifest.generatedAt);
  });

  it('atomicity: re-export after data shrinks leaves no stale files (C4a)', () => {
    seedMatch(db);
    seedRoleProb(db, [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
      { championId: 26, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    exportOnce();
    expect(
      readFileSync(
        join(process.env.DRAFTORB_PUBLIC_DIR as string, PATCH, 'role-prob.json'),
        'utf8',
      ),
    ).toContain('26');

    // Re-export with only 412 qualifying -> 26's files must be gone.
    db.prepare('DELETE FROM role_prob WHERE champion_id = 26').run();
    exportOnce();
    const publicDir = process.env.DRAFTORB_PUBLIC_DIR as string;
    const remaining = readdirSync(join(publicDir, PATCH), { recursive: true }) as string[];
    expect(remaining.some((p) => p.includes('26'))).toBe(false);
    const roleProb = readFile('role-prob.json') as Record<string, Record<string, number>>;
    expect(Object.keys(roleProb)).toEqual(['412']);
    // No temp dir left behind.
    expect(readdirSync(publicDir).some((p) => p.startsWith('.16.21.tmp'))).toBe(false);
  });

  it('atomicity: injected schema failure leaves previous export intact and no temp dir (C4b)', () => {
    seedMatch(db);
    seedRoleProb(db, [{ championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 }]);
    exportOnce();
    const previous = readFileSync(
      join(process.env.DRAFTORB_PUBLIC_DIR as string, PATCH, 'manifest.json'),
      'utf8',
    );

    // A rune row whose context_key is empty fails the shared rune schema (contextKey min 1)
    // inside the temp dir, so the whole export must abort without touching the previous export.
    seedRuneCtx(db, [
      {
        championId: 999,
        myRole: 'SUPPORT',
        contextKey: '',
        contextLevel: 5,
        perksHash: 'x',
        perksJson: validPerksJson,
        gamesW: 10,
        gamesW2: 10,
        winsW: 6,
        players: 1,
      },
    ]);

    expect(() => exportOnce()).toThrow(/Invalid rune export/);
    // Previous export intact.
    expect(
      readFileSync(join(process.env.DRAFTORB_PUBLIC_DIR as string, PATCH, 'manifest.json'), 'utf8'),
    ).toBe(previous);
    // No temp dir left behind.
    expect(
      readdirSync(process.env.DRAFTORB_PUBLIC_DIR as string).some((p) =>
        p.startsWith('.16.21.tmp'),
      ),
    ).toBe(false);
  });

  it('region: single platform uses it without warning; multiple platforms warn and use alphabetically first (C5)', () => {
    seedMatch(db, '16.21', 'euw1', 'm1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    exportOnce({ region: 'kr' });
    expect(readFile<{ region: string }>('manifest.json').region).toBe('kr');
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('platforms'))).toBe(false);
    logSpy.mockRestore();

    seedMatch(db, '16.21', 'na1', 'm2');
    const logSpy2 = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = exportOnce();
    expect(result.manifest.region).toBe('euw1'); // alphabetically first
    expect(logSpy2.mock.calls.some((c) => String(c[0]).includes('platforms'))).toBe(true);
    logSpy2.mockRestore();
  });
});
