// Test-only Node access: the engine tsconfig sets `types: []` to keep source
// pure (golden rule 3); this runner alone needs `node:fs` to load fixtures.
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { draftResultSchema } from '@draftorb/shared';
import type { ChampionId, DraftInput, Reason } from '@draftorb/shared';

import { recommend } from './recommend.js';
import type { DraftData } from './recommend.js';

/** Golden scenario file format (`packages/engine/test/golden/*.json`, TESTING.md). */
interface GoldenReason {
  readonly championId: ChampionId;
  readonly type: Reason['type'];
  readonly with: ChampionId[];
  readonly levelSign?: -1 | 0 | 1;
  readonly lowData?: boolean;
}

interface GoldenCase {
  readonly name: string;
  readonly input: DraftInput;
  readonly expected: {
    readonly order: ChampionId[];
    readonly insufficientData?: ChampionId[];
    readonly reasons?: GoldenReason[];
  };
}

interface GoldenFile {
  readonly data: DraftData;
  readonly cases: GoldenCase[];
}

const GOLDEN_DIR = fileURLToPath(new URL('../test/golden/', import.meta.url));

const files = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe.each(files)('golden %s', (file) => {
  const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as GoldenFile;

  it.each(golden.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = recommend(c.input, golden.data);
    expect(draftResultSchema.parse(result)).toEqual(result);
    expect(recommend(c.input, golden.data)).toEqual(result);
    expect(result.recommendations.map((r) => r.championId)).toEqual(c.expected.order);

    if (c.expected.insufficientData) {
      expect(result.insufficientData.map((e) => e.championId)).toEqual(
        c.expected.insufficientData,
      );
    }

    for (const g of c.expected.reasons ?? []) {
      const rec = result.recommendations.find((r) => r.championId === g.championId);
      const reason = rec?.reasons.find(
        (r) => r.type === g.type && JSON.stringify(r.with) === JSON.stringify(g.with),
      );
      expect(reason, `${g.championId} ${g.type} ${g.with.join(',')}`).toBeDefined();
      if (g.levelSign !== undefined) {
        expect(Math.sign(reason?.level ?? 0)).toBe(g.levelSign);
      }
      if (g.lowData !== undefined) {
        expect(reason?.lowData).toBe(g.lowData);
      }
    }
  });
});
