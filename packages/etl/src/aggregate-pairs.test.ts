import { describe, expect, it } from 'vitest';

import { nEff } from '@draftorb/engine';

import { openDb, migrate } from './db';
import { aggregatePairTables } from './aggregate-pairs';
import {
  requireLaneFullRow,
  requireLaneVsRow,
  requirePairRow,
  seedMatches,
  withFreshDb,
  withSeededDb,
} from './aggregate-pairs-helpers';

describe('aggregatePairTables', () => {
  it('support bot lane: pairs, lane_vs and lane_full for both perspectives', () => {
    withSeededDb(
      [
        {
          patch: '16.21',
          rankKnownCount: 2,
          participants: [
            // blue team (100): support + adc win
            { championId: 412, role: 'SUPPORT', win: 1, teamId: 100, puuid: 'p1' },
            { championId: 200, role: 'ADC', win: 1, teamId: 100, puuid: 'p2' },
            // red team (200): enemy support + enemy adc lose
            { championId: 300, role: 'SUPPORT', win: 0, teamId: 200, puuid: 'p3' },
            { championId: 301, role: 'ADC', win: 0, teamId: 200, puuid: 'p4' },
          ],
        },
      ],
      (db) => {
        const result = aggregatePairTables(db);

        // --- SUPPORT perspective: ally ADC, enemies [SUPPORT, ADC] ---
        const supAlly = requirePairRow(result.pairAlly, 412, 'SUPPORT', 200, 'ADC', 'DIAMOND');
        expect(supAlly.winsW).toBeCloseTo(1);
        expect(supAlly.games).toBe(1);
        expect(nEff(supAlly.gamesW, supAlly.gamesW2)).toBeCloseTo(1);

        const supEnemy1 = requirePairRow(
          result.pairEnemy,
          412,
          'SUPPORT',
          300,
          'SUPPORT',
          'DIAMOND',
        );
        expect(supEnemy1.winsW).toBeCloseTo(1);
        const supEnemy2 = requirePairRow(result.pairEnemy, 412, 'SUPPORT', 301, 'ADC', 'DIAMOND');
        expect(supEnemy2.winsW).toBeCloseTo(1);

        // lane_vs: opp1=enemy SUPPORT(300), opp2=enemy ADC(301) — laneGroup order
        const supLaneVs = requireLaneVsRow(result.laneVs, 412, 'SUPPORT', 300, 301, 'DIAMOND');
        expect(supLaneVs.winsW).toBeCloseTo(1);
        expect(supLaneVs.opp2Id).toBe(301);

        // lane_full: partner=ally ADC(200), opp1=300, opp2=301
        const supLaneFull = requireLaneFullRow(
          result.laneFull,
          412,
          'SUPPORT',
          200,
          300,
          301,
          'DIAMOND',
        );
        expect(supLaneFull.partnerId).toBe(200);
        expect(supLaneFull.winsW).toBeCloseTo(1);

        // --- ADC perspective: ally SUPPORT, enemies [ADC, SUPPORT] ---
        const adcAlly = requirePairRow(result.pairAlly, 200, 'ADC', 412, 'SUPPORT', 'DIAMOND');
        expect(adcAlly.winsW).toBeCloseTo(1);

        const adcEnemy1 = requirePairRow(result.pairEnemy, 200, 'ADC', 301, 'ADC', 'DIAMOND');
        expect(adcEnemy1.winsW).toBeCloseTo(1);
        const adcEnemy2 = requirePairRow(result.pairEnemy, 200, 'ADC', 300, 'SUPPORT', 'DIAMOND');
        expect(adcEnemy2.winsW).toBeCloseTo(1);

        // lane_vs: opp1=enemy ADC(301), opp2=enemy SUPPORT(300) — laneGroup order
        const adcLaneVs = requireLaneVsRow(result.laneVs, 200, 'ADC', 301, 300, 'DIAMOND');
        expect(adcLaneVs.winsW).toBeCloseTo(1);
        expect(adcLaneVs.opp2Id).toBe(300);

        // lane_full: partner=ally SUPPORT(412), opp1=301, opp2=300
        const adcLaneFull = requireLaneFullRow(
          result.laneFull,
          200,
          'ADC',
          412,
          301,
          300,
          'DIAMOND',
        );
        expect(adcLaneFull.partnerId).toBe(412);
        expect(adcLaneFull.winsW).toBeCloseTo(1);
      },
    );
  });

  it('TOP lane is 1v1: lane_vs has opp2 null, lane_full is empty', () => {
    withSeededDb(
      [
        {
          patch: '16.21',
          rankKnownCount: 2,
          participants: [
            { championId: 412, role: 'TOP', win: 1, teamId: 100, puuid: 'p1' },
            { championId: 200, role: 'TOP', win: 0, teamId: 200, puuid: 'p2' },
            { championId: 300, role: 'JUNGLE', win: 0, teamId: 200, puuid: 'p3' },
          ],
        },
      ],
      (db) => {
        const result = aggregatePairTables(db);

        // pair ally: none (TOP has no allies in laneGroup), pair enemy: TOP vs TOP
        const topEnemy = requirePairRow(result.pairEnemy, 412, 'TOP', 200, 'TOP', 'DIAMOND');
        expect(topEnemy.winsW).toBeCloseTo(1);

        // lane_vs: opp1=enemy TOP(200), opp2 null (1v1)
        const topLaneVs = requireLaneVsRow(result.laneVs, 412, 'TOP', 200, null, 'DIAMOND');
        expect(topLaneVs.winsW).toBeCloseTo(1);
        expect(topLaneVs.opp2Id).toBeNull();

        // lane_full: empty for 1v1 lane groups
        expect(result.laneFull).toEqual([]);
      },
    );
  });

  it('weighs games by recency across patches', () => {
    withSeededDb(
      [
        {
          patch: '16.20',
          rankKnownCount: 2,
          participants: [
            { championId: 412, role: 'SUPPORT', win: 1, teamId: 100, puuid: 'p1' },
            { championId: 200, role: 'ADC', win: 1, teamId: 100, puuid: 'p2' },
            { championId: 300, role: 'SUPPORT', win: 0, teamId: 200, puuid: 'p3' },
            { championId: 301, role: 'ADC', win: 0, teamId: 200, puuid: 'p4' },
          ],
        },
        {
          patch: '16.21',
          rankKnownCount: 2,
          participants: [
            { championId: 412, role: 'SUPPORT', win: 0, teamId: 100, puuid: 'p5' },
            { championId: 200, role: 'ADC', win: 0, teamId: 100, puuid: 'p6' },
            { championId: 300, role: 'SUPPORT', win: 1, teamId: 200, puuid: 'p7' },
            { championId: 301, role: 'ADC', win: 1, teamId: 200, puuid: 'p8' },
          ],
        },
      ],
      (db) => {
        const result = aggregatePairTables(db);
        const row = requirePairRow(result.pairAlly, 412, 'SUPPORT', 200, 'ADC', 'DIAMOND');
        // patch 16.20 recency 0.85, patch 16.21 recency 1 → w = 1.85
        // wins_w = 0.85*1 + 1*0 = 0.85 ; games_w2 = 0.85^2 + 1 = 1.7225
        expect(row.winsW).toBeCloseTo(0.85);
        expect(row.gamesW).toBeCloseTo(1.85);
        expect(row.gamesW2).toBeCloseTo(1.7225);
        expect(row.games).toBe(2);
        expect(nEff(row.gamesW, row.gamesW2)).toBeCloseTo(1.9871);
      },
    );
  });

  it('is idempotent across reruns', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        seedMatches(db, [
          {
            patch: '16.21',
            rankKnownCount: 2,
            participants: [
              { championId: 412, role: 'SUPPORT', win: 1, teamId: 100, puuid: 'p1' },
              { championId: 200, role: 'ADC', win: 1, teamId: 100, puuid: 'p2' },
              { championId: 300, role: 'SUPPORT', win: 0, teamId: 200, puuid: 'p3' },
              { championId: 301, role: 'ADC', win: 0, teamId: 200, puuid: 'p4' },
            ],
          },
        ]);
        const first = aggregatePairTables(db);
        const second = aggregatePairTables(db);
        expect(second).toEqual(first);
        const expectedCounts = {
          pair_ally: first.pairAlly.length,
          pair_enemy: first.pairEnemy.length,
          lane_vs: first.laneVs.length,
          lane_full: first.laneFull.length,
        };
        for (const table of Object.keys(expectedCounts)) {
          expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toMatchObject({
            count: expectedCounts[table as keyof typeof expectedCounts],
          });
        }
      } finally {
        db.close();
      }
    });
  });

  it('leaves tables empty and unchanged when there are no participants', () => {
    withFreshDb((dbPath) => {
      const db = openDb(dbPath);
      try {
        migrate(db);
        const result = aggregatePairTables(db);
        expect(result.pairAlly).toEqual([]);
        expect(result.pairEnemy).toEqual([]);
        expect(result.laneVs).toEqual([]);
        expect(result.laneFull).toEqual([]);
        for (const table of ['pair_ally', 'pair_enemy', 'lane_vs', 'lane_full']) {
          expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toMatchObject({
            count: 0,
          });
        }
      } finally {
        db.close();
      }
    });
  });

  it('snapshot patch excludes newer matches', () => {
    withSeededDb(
      [
        {
          patch: '16.20',
          rankKnownCount: 2,
          participants: [
            { championId: 412, role: 'SUPPORT', win: 1, teamId: 100, puuid: 'p1' },
            { championId: 200, role: 'ADC', win: 1, teamId: 100, puuid: 'p2' },
            { championId: 300, role: 'SUPPORT', win: 0, teamId: 200, puuid: 'p3' },
            { championId: 301, role: 'ADC', win: 0, teamId: 200, puuid: 'p4' },
          ],
        },
        {
          patch: '16.21',
          rankKnownCount: 2,
          participants: [
            { championId: 412, role: 'SUPPORT', win: 0, teamId: 100, puuid: 'p5' },
            { championId: 200, role: 'ADC', win: 0, teamId: 100, puuid: 'p6' },
            { championId: 300, role: 'SUPPORT', win: 1, teamId: 200, puuid: 'p7' },
            { championId: 301, role: 'ADC', win: 1, teamId: 200, puuid: 'p8' },
          ],
        },
      ],
      (db) => {
        const before = aggregatePairTables(db);
        expect(requirePairRow(before.pairAlly, 412, 'SUPPORT', 200, 'ADC', 'DIAMOND').games).toBe(
          2,
        );

        const snapshot = aggregatePairTables(db, { patch: '16.20' });
        const row = requirePairRow(snapshot.pairAlly, 412, 'SUPPORT', 200, 'ADC', 'DIAMOND');
        // only the 16.20 game: wins_w=1, games_w=1
        expect(row.games).toBe(1);
        expect(row.winsW).toBeCloseTo(1);
        expect(row.gamesW).toBeCloseTo(1);
      },
    );
  });

  it('skips lanes when a lane-group champion is missing but still counts pairs', () => {
    withSeededDb(
      [
        {
          patch: '16.21',
          rankKnownCount: 2,
          participants: [
            { championId: 412, role: 'SUPPORT', win: 1, teamId: 100, puuid: 'p1' },
            // no ally ADC, no enemy ADC — only enemy support present
            { championId: 300, role: 'SUPPORT', win: 0, teamId: 200, puuid: 'p2' },
          ],
        },
      ],
      (db) => {
        const result = aggregatePairTables(db);
        const allyRow = requirePairRow(result.pairEnemy, 412, 'SUPPORT', 300, 'SUPPORT', 'DIAMOND');
        expect(allyRow.games).toBe(1);

        // lane_vs incomplete (opp2 missing) → no lane rows
        expect(result.laneVs).toEqual([]);
        expect(result.laneFull).toEqual([]);
      },
    );
  });
});
