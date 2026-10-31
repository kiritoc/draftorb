/**
 * D-011 contract parity tests.
 *
 * These tests assert that every schema and field required by SPECS §3/§5/§7/§8
 * and DATA_MODEL.md is exported from the shared package. They fail loudly if a
 * required schema or field is removed or renamed, preventing silent contract
 * drift between the shared schemas and the specs.
 *
 * Run with: pnpm test packages/shared/src/schemas/parity.test.ts
 */

import { describe, it, expect } from 'vitest';

import * as shared from '../index.js';

describe('shared schema parity (D-011)', () => {
  it('exports core schemas: role, rank, rankBucket, championId, itemId', () => {
    expect(shared.roleSchema).toBeDefined();
    expect(shared.rankSchema).toBeDefined();
    expect(shared.rankBucketSchema).toBeDefined();
    expect(shared.championIdSchema).toBeDefined();
    expect(shared.itemIdSchema).toBeDefined();
    expect(shared.damageTypeSchema).toBeDefined();
    expect(shared.championRangeSchema).toBeDefined();
    expect(shared.SHARED_VERSION).toBeDefined();
    expect(shared.MANIFEST_SCHEMA_VERSION).toBe(1);
  });

  it('exports rankBucketSchema with exactly the 8 SPECS §3 buckets', () => {
    const buckets = shared.rankBucketSchema.options;
    expect(buckets).toHaveLength(8);
    expect(buckets).toContain('IRON');
    expect(buckets).toContain('BRONZE');
    expect(buckets).toContain('SILVER');
    expect(buckets).toContain('GOLD');
    expect(buckets).toContain('PLATINUM');
    expect(buckets).toContain('EMERALD');
    expect(buckets).toContain('DIAMOND');
    expect(buckets).toContain('MASTER_PLUS');
    expect(buckets).not.toContain('MASTER');
    expect(buckets).not.toContain('GRANDMASTER');
    expect(buckets).not.toContain('CHALLENGER');
  });

  it('exports rankSchema with the 10 raw rank tiers (not buckets)', () => {
    const tiers = shared.rankSchema.options;
    expect(tiers).toHaveLength(10);
    expect(tiers).toContain('MASTER');
    expect(tiers).toContain('GRANDMASTER');
    expect(tiers).toContain('CHALLENGER');
  });

  it('exports reason schemas with lane type, array with, lowData, and n_eff', () => {
    expect(shared.reasonTypeSchema).toBeDefined();
    expect(shared.reasonTypeSchema.options).toContain('synergy');
    expect(shared.reasonTypeSchema.options).toContain('counter');
    expect(shared.reasonTypeSchema.options).toContain('comp');
    expect(shared.reasonTypeSchema.options).toContain('blind');
    expect(shared.reasonTypeSchema.options).toContain('lane');
    expect(shared.reasonSchema).toBeDefined();
    expect(shared.reasonLevelSchema).toBeDefined();
    expect(shared.reliabilitySchema).toBeDefined();
  });

  it('exports recommendation schema with poolRank', () => {
    expect(shared.recommendationSchema).toBeDefined();
    const result = shared.recommendationSchema.safeParse({
      championId: 41,
      score: 0.7,
      rank: 1,
      poolRank: 1,
      reasons: [],
      reliability: { games: 100, lowData: false },
      warnings: [],
    });
    expect(result.success).toBe(true);
  });

  it('exports draft input and pool schemas', () => {
    expect(shared.slotSchema).toBeDefined();
    expect(shared.draftInputSchema).toBeDefined();
    expect(shared.championPoolSchema).toBeDefined();

    const pool = shared.championPoolSchema.safeParse({
      version: 1,
      pools: { SUPPORT: [41] },
    });
    expect(pool.success).toBe(true);
  });

  it('exports DraftResult with insufficientData, poolRecommendations, poolUnavailable', () => {
    expect(shared.draftResultSchema).toBeDefined();
    const minimal = shared.draftResultSchema.safeParse({
      recommendations: [],
      insufficientData: [{ championId: 41, nEff: 12.5, rawGames: 20 }],
    });
    expect(minimal.success).toBe(true);

    const full = shared.draftResultSchema.safeParse({
      recommendations: [
        {
          championId: 41,
          score: 0.7,
          rank: 1,
          reasons: [{ type: 'lane', with: [41, 34], lowData: false, n: 100.5 }],
          reliability: { games: 150.3, lowData: false },
          warnings: [],
        },
      ],
      insufficientData: [{ championId: 54, nEff: 12.5, rawGames: 20 }],
      poolRecommendations: [
        {
          championId: 41,
          score: 0.7,
          rank: 1,
          poolRank: 1,
          reasons: [],
          reliability: { games: 150.3, lowData: false },
          warnings: [],
        },
      ],
      poolUnavailable: [{ championId: 54, reason: 'insufficientData' }],
    });
    expect(full.success).toBe(true);
  });

  it('exports sparse championRoleProbabilitiesSchema with sum-to-1 invariant', () => {
    expect(shared.championRoleProbabilitiesSchema).toBeDefined();

    const sparse = shared.championRoleProbabilitiesSchema.safeParse({
      '41': { SUPPORT: 1.0 },
      '34': { TOP: 0.7, JUNGLE: 0.3 },
    });
    expect(sparse.success).toBe(true);

    const nonSparse = shared.championRoleProbabilitiesSchema.safeParse({
      '41': { SUPPORT: 0.5 },
    });
    expect(nonSparse.success).toBe(false);
  });

  it('exports champion, championsMap, tags schemas', () => {
    expect(shared.championSchema).toBeDefined();
    expect(shared.championsMapSchema).toBeDefined();
    expect(shared.championTagsSchema).toBeDefined();
    expect(shared.championTagsMapSchema).toBeDefined();
    expect(shared.championTagsScalingSchema).toBeDefined();
  });

  it('exports manifest schema with roles and rankBuckets', () => {
    expect(shared.manifestSchema).toBeDefined();
    expect(shared.manifestFileSchema).toBeDefined();
    const manifest = shared.manifestSchema.safeParse({
      patch: '14.23',
      generatedAt: '2026-01-01T00:00:00Z',
      region: 'EUW',
      rankBuckets: ['DIAMOND'],
      roles: ['SUPPORT'],
      files: [{ path: 'champions.json' }],
      schemaVersion: 1,
    });
    expect(manifest.success).toBe(true);
    expect(manifest.data).toMatchObject({ schemaVersion: 1 });
    expect(() =>
      shared.manifestSchema.parse({
        ...manifest.data,
        schemaVersion: 2,
      }),
    ).toThrow();
  });

  it('exports support pair and baseline schemas with rankBucket + gamesW2', () => {
    expect(shared.supportPairEntrySchema).toBeDefined();
    expect(shared.supportPairTableSchema).toBeDefined();
    expect(shared.supportBaselineEntrySchema).toBeDefined();
    expect(shared.supportBaselineTableSchema).toBeDefined();

    const baseline = shared.supportBaselineEntrySchema.safeParse({
      championId: 41,
      rankBucket: 'DIAMOND',
      winsWeighted: 52.4,
      gamesWeighted: 100.0,
      gamesW2: 250.0,
    });
    expect(baseline.success).toBe(true);

    const pair = shared.supportPairEntrySchema.safeParse([
      41,
      18,
      'ADC',
      'DIAMOND',
      52.4,
      100.0,
      250.0,
    ]);
    expect(pair.success).toBe(true);
  });

  it('exports role-keyed aggregate export schemas with gamesW2 on every row', () => {
    expect(shared.baselineEntrySchema).toBeDefined();
    expect(shared.baselineTableSchema).toBeDefined();
    expect(shared.allyPairEntrySchema).toBeDefined();
    expect(shared.allyPairTableSchema).toBeDefined();
    expect(shared.enemyPairEntrySchema).toBeDefined();
    expect(shared.enemyPairTableSchema).toBeDefined();
    expect(shared.laneVsEntrySchema).toBeDefined();
    expect(shared.laneVsTableSchema).toBeDefined();
    expect(shared.laneFullEntrySchema).toBeDefined();
    expect(shared.laneFullTableSchema).toBeDefined();

    const baseline = shared.baselineEntrySchema.safeParse([
      41,
      'DIAMOND',
      52.4,
      100.0,
      250.0,
      120,
    ]);
    expect(baseline.success).toBe(true);

    const allyPair = shared.allyPairEntrySchema.safeParse([
      41,
      18,
      'ADC',
      'DIAMOND',
      52.4,
      100.0,
      250.0,
    ]);
    expect(allyPair.success).toBe(true);

    const enemyPair = shared.enemyPairEntrySchema.safeParse([
      41,
      34,
      'TOP',
      'EMERALD',
      40.0,
      80.0,
      160.0,
    ]);
    expect(enemyPair.success).toBe(true);

    const laneVs = shared.laneVsEntrySchema.safeParse([
      41,
      34,
      null,
      'DIAMOND',
      50.0,
      100.0,
      250.0,
    ]);
    expect(laneVs.success).toBe(true);

    const laneFull = shared.laneFullEntrySchema.safeParse([
      41,
      18,
      34,
      54,
      'DIAMOND',
      50.0,
      100.0,
      250.0,
    ]);
    expect(laneFull.success).toBe(true);
  });

  it('exports item and item-tag schemas', () => {
    expect(shared.itemSchema).toBeDefined();
    expect(shared.itemsMapSchema).toBeDefined();
    expect(shared.itemTagsSchema).toBeDefined();
    expect(shared.itemTagsMapSchema).toBeDefined();
  });

  it('exports item build export schemas', () => {
    expect(shared.itemBuildStateBucketSchema).toBeDefined();
    expect(shared.itemBuildProfileKeySchema).toBeDefined();
    expect(shared.itemBuildEntrySchema).toBeDefined();
    expect(shared.itemBuildContextSchema).toBeDefined();
    expect(shared.itemBuildExportSchema).toBeDefined();

    const build = shared.itemBuildExportSchema.safeParse({
      championId: 41,
      myRole: 'SUPPORT',
      contexts: [
        {
          slotIdx: 1,
          timeBucket: '5-10min',
          stateBucket: 'ahead',
          profileKey: 'AP',
          laneKey: 'lane:enemySupport,enemyAdc',
          items: [
            {
              itemId: 3089,
              winsW: 154.2,
              gamesW: 300.0,
              gamesW2: 900.0,
              winrate: 0.534,
              pickShare: 0.41,
            },
          ],
        },
      ],
    });
    expect(build.success).toBe(true);
  });

  it('exports rune schemas', () => {
    expect(shared.runePerkSchema).toBeDefined();
    expect(shared.runeTreeSchema).toBeDefined();
    expect(shared.runeTreesSchema).toBeDefined();
    expect(shared.runePageSchema).toBeDefined();
  });

  it('exports rune export schemas with gamesW2 on pages', () => {
    expect(shared.runeContextPageSchema).toBeDefined();
    expect(shared.runeContextEntrySchema).toBeDefined();
    expect(shared.runeExportSchema).toBeDefined();

    const rune = shared.runeExportSchema.safeParse({
      championId: 41,
      myRole: 'SUPPORT',
      contexts: [
        {
          contextKey: 'lane:enemySupport,enemyAdc',
          contextLevel: 1,
          pages: [
            {
              primaryStyleId: 8000,
              subStyleId: 8400,
              keystoneId: 8005,
              selectedPerkIds: [8005],
              winsW: 154.2,
              gamesW: 300.0,
              gamesW2: 900.0,
              winrate: 0.534,
              pickShare: 0.41,
            },
          ],
        },
      ],
    });
    expect(rune.success).toBe(true);
  });

  it('exports zod for downstream re-use', () => {
    expect(shared.z).toBeDefined();
    expect(typeof shared.z.string).toBe('function');
  });
});
