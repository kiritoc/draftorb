import { describe, expect, it } from 'vitest';

import { seed, validPerksJson } from './export.fixtures.js';
import { createExportTestSuite } from './export.test-utils.js';
import { buildTableFile, TABLE_SPECS } from './role-tables.js';

const suite = createExportTestSuite();

describe('exportJson', () => {
  it('exports role-keyed tables as tuples filtered by n_eff (E1 exact enemy-pairs)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'baseline', [
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
    seed(suite.db, 'pairAlly', [
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
    seed(suite.db, 'pairEnemy', [
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
    seed(suite.db, 'laneVs', [
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
    seed(suite.db, 'laneFull', [
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

    suite.exportOnce();

    const baseline = suite.readFile('roles/SUPPORT/baseline.json') as [
      number,
      string,
      number,
      number,
      number,
      number?,
    ][];
    expect(baseline).toEqual([[412, 'IRON', 6, 10, 10, 3]]);

    const ally = suite.readFile('roles/SUPPORT/ally-pairs.json') as [
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
    const enemy = suite.readFile('roles/SUPPORT/enemy-pairs.json') as [
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
    const laneVs = suite.readFile('roles/SUPPORT/lane-vs.json') as [
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
    const laneFull = suite.readFile('roles/SUPPORT/lane-full.json') as [
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

  it('excludes non-SUPPORT role-keyed files while role-prob remains global (X2)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'baseline', [
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
    seed(suite.db, 'runeCtx', [
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
    seed(suite.db, 'itemBuild', [
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
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'MID', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);

    const result = suite.exportOnce();
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/MID/baseline.json');
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/MID/runes/412.json');
    expect(result.files.map((f) => f.relativePath)).not.toContain('roles/MID/builds/412.json');
    // role-prob.json is global, independent of the selected role-keyed files.
    expect(suite.readFile('role-prob.json')).toEqual({ '412': { MID: 1 } });
  });

  it('wraps table role validation errors with the output path (A6)', () => {
    expect(() => buildTableFile(TABLE_SPECS[0], [], 'UNKNOWN', 0)).toThrow(
      /Invalid table export for roles\/UNKNOWN\/baseline\.json/,
    );
  });
});
