/**
 * Golden test runner for the recommendation engine (T-023, TESTING.md §2).
 *
 * Loads fixture JSON files from `packages/engine/test/golden/*.json`, each
 * containing a `DraftInput`-style input, pre-loaded data tables, and the
 * expected `DraftResult` (championId rankings + reason shapes + levels).
 *
 * Lives outside `src/` so the Node file APIs it needs never sit next to the
 * pure engine sources (golden rule 3, B-021). `recommend` itself does no I/O.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { recommend, type RecommendData } from '../src/recommend.js';
import type { ChampionId, DraftInput, DraftResult } from '@draftorb/shared';

interface GoldenFixture {
  name: string;
  input: DraftInput;
  data: RecommendData;
  expected: {
    recommendations: Array<{
      championId: number;
      rank: number;
      reasons?: Array<{
        type: string;
        lowData?: boolean;
        level?: number;
      }>;
      warnings?: string[];
    }>;
    poolRecommendations?: Array<{
      championId: number;
      rank: number;
      poolRank?: number;
    }>;
    poolUnavailable?: Array<{
      championId: number;
      reason: string;
    }>;
    insufficientData?: Array<{
      championId: number;
    }>;
  };
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const goldenDir = join(__dirname, 'golden');

const fixtureFiles = readdirSync(goldenDir).filter((f) => f.endsWith('.json'));

for (const file of fixtureFiles) {
  const fullPath = join(goldenDir, file);
  const raw = readFileSync(fullPath, 'utf-8');
  const json = JSON.parse(raw) as GoldenFixture & { champions?: ChampionId[] };
  const fixture: GoldenFixture = {
    name: json.name,
    input: json.input,
    data: {
      baselines: json.data.baselines,
      allyPairs: json.data.allyPairs,
      enemyPairs: json.data.enemyPairs,
      laneVs: json.data.laneVs,
      laneFull: json.data.laneFull,
      roleProb: json.data.roleProb,
      tags: json.data.tags,
      championIds: json.champions ?? json.data.championIds ?? [],
    },
    expected: json.expected,
  };

  describe(`golden: ${fixture.name}`, () => {
    it('produces the expected championId ranking', () => {
      const result: DraftResult = recommend(fixture.input, fixture.data);

      const expectedIds = fixture.expected.recommendations.map((r) => r.championId);
      const actualIds = result.recommendations.map((r) => r.championId);
      expect(actualIds).toEqual(expectedIds);
    });

    it('assigns correct ranks', () => {
      const result = recommend(fixture.input, fixture.data);

      for (const expected of fixture.expected.recommendations) {
        const rec = result.recommendations.find((r) => r.championId === expected.championId);
        expect(rec).toBeDefined();
        if (rec) {
          expect(rec.rank).toBe(expected.rank);
        }
      }
    });

    it('produces expected reason types and lowData flags where specified', () => {
      const result = recommend(fixture.input, fixture.data);

      for (const expected of fixture.expected.recommendations) {
        const rec = result.recommendations.find((r) => r.championId === expected.championId);
        expect(rec).toBeDefined();
        if (!rec) continue;

        if (expected.reasons) {
          // Each expected reason consumes the next unused actual reason of the
          // same type, so repeated types (e.g. two counters) are all checked.
          const used = new Set<number>();
          for (const expReason of expected.reasons) {
            const idx = rec.reasons.findIndex((r, i) => !used.has(i) && r.type === expReason.type);
            expect(idx).toBeGreaterThanOrEqual(0);
            used.add(idx);
            const matchingReason = rec.reasons[idx];
            expect(matchingReason).toBeDefined();

            if (matchingReason && expReason.lowData !== undefined) {
              expect(matchingReason.lowData).toBe(expReason.lowData);
            }
            if (matchingReason && expReason.level !== undefined) {
              expect(matchingReason.level).toBe(expReason.level);
            }
          }
        }

        if (expected.warnings) {
          expect(rec.warnings).toEqual(expected.warnings);
        }
      }
    });

    it('matches pool expectations when specified', () => {
      const result = recommend(fixture.input, fixture.data);

      if (fixture.expected.poolRecommendations) {
        expect(result.poolRecommendations).toBeDefined();
        const expectedPoolIds = fixture.expected.poolRecommendations.map((r) => r.championId);
        const actualPoolIds = result.poolRecommendations?.map((r) => r.championId) ?? [];
        expect(actualPoolIds).toEqual(expectedPoolIds);

        for (const expPool of fixture.expected.poolRecommendations) {
          const rec = result.poolRecommendations?.find((r) => r.championId === expPool.championId);
          expect(rec).toBeDefined();
          if (rec) {
            expect(rec.rank).toBe(expPool.rank);
            if (expPool.poolRank !== undefined) {
              expect(rec.poolRank).toBe(expPool.poolRank);
            }
          }
        }
      }

      if (fixture.expected.poolUnavailable) {
        expect(result.poolUnavailable).toBeDefined();
        for (const expUnavail of fixture.expected.poolUnavailable) {
          const entry = result.poolUnavailable?.find((u) => u.championId === expUnavail.championId);
          expect(entry).toBeDefined();
          if (entry) {
            expect(entry.reason).toBe(expUnavail.reason);
          }
        }
      }

      if (fixture.expected.insufficientData) {
        for (const expInsuff of fixture.expected.insufficientData) {
          const entry = result.insufficientData.find((i) => i.championId === expInsuff.championId);
          expect(entry).toBeDefined();
        }
      }
    });

    it('is deterministic (same input produces identical output)', () => {
      const result1 = recommend(fixture.input, fixture.data);
      const result2 = recommend(fixture.input, fixture.data);
      expect(result1).toEqual(result2);
    });
  });
}

describe('golden: fixtures', () => {
  it('finds at least one fixture (a broken path must not pass silently)', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });
});
