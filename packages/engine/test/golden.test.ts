/**
 * Golden test runner for the recommendation engine (T-023, extended by T-026;
 * TESTING.md §2).
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
import type { DraftInput, DraftResult } from '@draftorb/shared';
import { draftInputSchema, recommendDataSchema } from '@draftorb/shared';

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
        with?: number[];
        lowData?: boolean;
        level?: number;
        deltaPp?: number;
      }>;
      /** When true with `reasons`, the reason list must match exactly:
       *  same length and each expected entry matches the actual reason at the
       *  same index on every specified field (pins the full reason order). */
      allReasons?: boolean;
      warnings?: string[];
    }>;
    /** `null` asserts the field is absent from the result (e.g. empty pool). */
    poolRecommendations?: Array<{
      championId: number;
      rank: number;
      poolRank?: number;
    }> | null;
    poolUnavailable?: Array<{
      championId: number;
      reason: string;
    }> | null;
    insufficientData?: Array<{
      championId: number;
    }>;
  };
}

// Strict: a misspelled key (e.g. `lowdata`) must fail instead of skipping an assertion.
// Hand-rolled (no direct zod dependency in @draftorb/engine).
type Check = (v: unknown, path: string) => void;

function fail(path: string, msg: string): never {
  throw new Error(`golden expected ${path}: ${msg}`);
}
const posInt: Check = (v, p) => {
  if (!Number.isInteger(v) || (v as number) <= 0) fail(p, 'expected a positive integer');
};
const int: Check = (v, p) => {
  if (!Number.isInteger(v)) fail(p, 'expected an integer');
};
const num: Check = (v, p) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(p, 'expected a finite number');
};
const str: Check = (v, p) => {
  if (typeof v !== 'string') fail(p, 'expected a string');
};
const bool: Check = (v, p) => {
  if (typeof v !== 'boolean') fail(p, 'expected a boolean');
};
const arrayOf =
  (item: Check): Check =>
  (v, p) => {
    if (!Array.isArray(v)) fail(p, 'expected an array');
    v.forEach((x, i) => item(x, `${p}[${i}]`));
  };
const strictObject =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(p, 'expected an object');
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (!Object.hasOwn(required, k) && !Object.hasOwn(optional, k)) {
        fail(`${p}.${k}`, 'unknown key');
      }
    }
    for (const [k, c] of Object.entries(required)) c(o[k], `${p}.${k}`);
    for (const [k, c] of Object.entries(optional)) if (o[k] !== undefined) c(o[k], `${p}.${k}`);
  };

const nullableArrayOf =
  (item: Check): Check =>
  (v, p) => {
    if (v === null) return;
    arrayOf(item)(v, p);
  };

const idRank = { championId: posInt, rank: posInt };
const checkExpected = strictObject(
  {
    recommendations: arrayOf(
      strictObject(idRank, {
        reasons: arrayOf(
          strictObject(
            { type: str },
            { with: arrayOf(posInt), lowData: bool, level: int, deltaPp: num },
          ),
        ),
        allReasons: bool,
        warnings: arrayOf(str),
      }),
    ),
  },
  {
    poolRecommendations: nullableArrayOf(strictObject(idRank, { poolRank: posInt })),
    poolUnavailable: nullableArrayOf(strictObject({ championId: posInt, reason: str })),
    insufficientData: arrayOf(strictObject({ championId: posInt })),
  },
);

function parseExpected(v: unknown): GoldenFixture['expected'] {
  checkExpected(v, 'expected');
  return v as GoldenFixture['expected'];
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const goldenDir = join(__dirname, 'golden');

const fixtureFiles = readdirSync(goldenDir).filter((f) => f.endsWith('.json'));

for (const file of fixtureFiles) {
  const fullPath = join(goldenDir, file);
  const raw = readFileSync(fullPath, 'utf-8');
  // Validate input/data with the shared zod schemas (never trust raw JSON).
  const json: unknown = JSON.parse(raw);
  const obj = json as { name?: unknown; input?: unknown; data?: unknown; expected?: unknown };
  if (typeof obj.name !== 'string' || typeof obj.expected !== 'object' || !obj.expected) {
    throw new Error(`golden fixture ${file}: missing name or expected`);
  }
  const fixture: GoldenFixture = {
    name: obj.name,
    input: draftInputSchema.parse(obj.input),
    data: recommendDataSchema.parse(obj.data),
    expected: parseExpected(obj.expected),
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
          // Expected reasons must appear in canonical order (an ordered
          // subsequence): each one matches the next actual reason of its type
          // — and of its `with` list when the fixture pins one — after the
          // previous match, so repeated types, lane contexts and order are
          // checked. With `allReasons` the lists must match index by index.
          const sameWith = (actual: number[] | undefined, expectedWith: number[]): boolean =>
            actual !== undefined &&
            actual.length === expectedWith.length &&
            actual.every((id, i) => id === expectedWith[i]);
          const matchesExpected = (
            actual: (typeof rec.reasons)[number],
            expReason: (typeof expected.reasons)[number],
          ): boolean =>
            actual.type === expReason.type &&
            (expReason.with === undefined || sameWith(actual.with, expReason.with));
          const assertFields = (
            actual: (typeof rec.reasons)[number],
            expReason: (typeof expected.reasons)[number],
          ): void => {
            if (expReason.lowData !== undefined) {
              expect(actual.lowData).toBe(expReason.lowData);
            }
            if (expReason.level !== undefined) {
              expect(actual.level).toBe(expReason.level);
            }
            if (expReason.deltaPp !== undefined) {
              expect(actual.deltaPp).toBe(expReason.deltaPp);
            }
          };
          if (expected.allReasons) {
            expect(rec.reasons).toHaveLength(expected.reasons.length);
            expected.reasons.forEach((expReason, i) => {
              const actual = rec.reasons[i];
              expect(actual).toBeDefined();
              if (!actual) return;
              expect(matchesExpected(actual, expReason)).toBe(true);
              assertFields(actual, expReason);
            });
          } else {
            let cursor = 0;
            for (const expReason of expected.reasons) {
              const offset = rec.reasons
                .slice(cursor)
                .findIndex((r) => matchesExpected(r, expReason));
              expect(offset).toBeGreaterThanOrEqual(0);
              const idx = cursor + offset;
              cursor = idx + 1;
              const matchingReason = rec.reasons[idx];
              expect(matchingReason).toBeDefined();
              if (matchingReason) assertFields(matchingReason, expReason);
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

      // `null` asserts the field is absent (e.g. an empty pool emits no pool lists).
      if (fixture.expected.poolRecommendations === null) {
        expect(result.poolRecommendations).toBeUndefined();
      } else if (fixture.expected.poolRecommendations) {
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

      if (fixture.expected.poolUnavailable === null) {
        expect(result.poolUnavailable).toBeUndefined();
      } else if (fixture.expected.poolUnavailable) {
        expect(result.poolUnavailable).toBeDefined();
        // Exact set: an extra or duplicated entry must fail the fixture.
        const key = (u: { championId: number; reason: string }): string =>
          `${u.championId}:${u.reason}`;
        expect((result.poolUnavailable ?? []).map(key).sort()).toEqual(
          fixture.expected.poolUnavailable.map(key).sort(),
        );
        for (const expUnavail of fixture.expected.poolUnavailable) {
          const entry = result.poolUnavailable?.find((u) => u.championId === expUnavail.championId);
          expect(entry).toBeDefined();
          if (entry) {
            expect(entry.reason).toBe(expUnavail.reason);
          }
        }
      }

      if (fixture.expected.insufficientData) {
        // Exact set: an unexpected insufficientData entry must fail the fixture.
        const sortIds = (xs: Array<{ championId: number }>): number[] =>
          xs.map((x) => x.championId).sort((a, b) => a - b);
        expect(sortIds(result.insufficientData)).toEqual(
          sortIds(fixture.expected.insufficientData),
        );
      }
    });

    it('is deterministic (same input produces identical output)', () => {
      const result1 = recommend(fixture.input, fixture.data);
      const result2 = recommend(fixture.input, fixture.data);
      expect(result1).toEqual(result2);
    });

    it('emits reasons in canonical layer order (pairs, lane, comp, blind)', () => {
      // SPECS §5/T-026: pair reasons first (synergy/counter interleaved by
      // influence), then lane reasons, then comp, then blind. Pair order within
      // the first group and lane_vs vs lane_full order are pinned per-fixture
      // via the `with` lists.
      const layerOrder: Record<string, number> = {
        synergy: 0,
        counter: 0,
        lane: 1,
        comp: 2,
        blind: 3,
      };
      const result = recommend(fixture.input, fixture.data);
      for (const rec of result.recommendations) {
        let previous = -1;
        for (const reason of rec.reasons) {
          const order = layerOrder[reason.type];
          if (order === undefined) throw new Error(`unknown reason type ${reason.type}`);
          expect(order).toBeGreaterThanOrEqual(previous);
          previous = order;
        }
      }
    });
  });
}

describe('golden: fixtures', () => {
  it('finds at least one fixture (a broken path must not pass silently)', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });
});
