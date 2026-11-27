import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@draftorb/engine';
import { RUNE_CONTEXT_LEVELS } from '@draftorb/shared';
import { seed } from './export.fixtures.js';
import { createExportTestSuite } from './export.test-utils.js';
import { buildSummonerFiles, type SummonerCtxRow } from './summoners.js';

const suite = createExportTestSuite();

function summonerRow(overrides: Partial<SummonerCtxRow> = {}): SummonerCtxRow {
  return {
    championId: 412,
    myRole: 'SUPPORT',
    rankBucket: 'DIAMOND',
    contextKey: 'global',
    contextLevel: RUNE_CONTEXT_LEVELS.global,
    spellPair: '4:14',
    winsW: 6,
    gamesW: 10,
    gamesW2: 10,
    players: 3,
    ...overrides,
  };
}

describe('buildSummonerFiles', () => {
  it('normalizes pairs, computes pickShare and applies the evidence gates', () => {
    const rows: SummonerCtxRow[] = [
      summonerRow({ spellPair: '4:14', gamesW: 15, gamesW2: 15, winsW: 6, players: 3 }),
      summonerRow({ spellPair: '4:7', gamesW: 10, gamesW2: 10, winsW: 4, players: 3 }),
      summonerRow({ spellPair: '4:12', gamesW: 10, gamesW2: 10, winsW: 5, players: 1 }), // players gate
      summonerRow({ spellPair: 'bad', gamesW: 10, gamesW2: 10, winsW: 5, players: 3 }), // malformed
    ];
    const { files, skippedSpellPairs } = buildSummonerFiles(rows, ['SUPPORT'], 10, 2);

    expect(files).toHaveLength(1);
    expect(files[0]?.relativePath).toBe('roles/SUPPORT/summoners/412.json');
    const parsed = JSON.parse(files[0]?.content ?? '{}') as {
      championId: number;
      myRole: string;
      contexts: Array<{
        rankBucket: string;
        pairs: Array<{
          summoner1Id: number;
          summoner2Id: number;
          winrate: number;
          pickShare: number;
          players?: number;
        }>;
      }>;
    };
    expect(parsed.championId).toBe(412);
    expect(parsed.myRole).toBe('SUPPORT');
    const pairs = parsed.contexts[0]?.pairs ?? [];
    // Raw denominator: 15 + 10 + 10 + 10 = 45 (pre-gate rows count).
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.summoner1Id).toBe(4);
    expect(pairs[0]?.summoner2Id).toBe(14);
    expect(pairs[0]?.pickShare).toBeCloseTo(15 / 45, 6);
    expect(pairs[1]?.pickShare).toBeCloseTo(10 / 45, 6);
    expect(pairs[0]?.winrate).toBeCloseTo(6 / 15, 6);
    expect(pairs[0]?.players).toBe(3);
    expect(skippedSpellPairs).toBe(1);
  });
});

describe('exportJson summoners', () => {
  it('writes roles/<ROLE>/summoners/<championId>.json through the full export', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'summonerCtx', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        spellPair: '4:14',
        winsW: 6,
        gamesW: 10,
        gamesW2: 10,
        players: 3,
      },
      {
        championId: 412,
        myRole: 'TOP',
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        spellPair: '4:12',
        winsW: 7,
        gamesW: 10,
        gamesW2: 10,
        players: 3,
      },
    ]);
    const result = suite.exportOnce({ roles: ['SUPPORT', 'TOP'] });
    expect(result.files.map((f) => f.relativePath)).toContain('roles/SUPPORT/summoners/412.json');
    expect(result.files.map((f) => f.relativePath)).toContain('roles/TOP/summoners/412.json');
    const file = suite.readFile('roles/SUPPORT/summoners/412.json') as {
      contexts: Array<{ pairs: Array<{ summoner1Id: number; summoner2Id: number }> }>;
    };
    expect(file.contexts[0]?.pairs[0]).toMatchObject({ summoner1Id: 4, summoner2Id: 14 });
  });

  it('suppresses pairs below evidenceMinDistinctPlayers (D-102)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'summonerCtx', [
      {
        championId: 412,
        myRole: 'SUPPORT',
        contextKey: 'global',
        contextLevel: RUNE_CONTEXT_LEVELS.global,
        spellPair: '4:14',
        winsW: 6,
        gamesW: 10,
        gamesW2: 10,
        players: 1,
      },
    ]);
    const result = suite.exportOnce({
      config: { ...DEFAULT_CONFIG, evidenceMinDistinctPlayers: 2 },
    });
    expect(result.files.map((f) => f.relativePath)).not.toContain(
      'roles/SUPPORT/summoners/412.json',
    );
  });
});
