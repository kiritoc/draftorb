import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ChampionsMap, ChampionTagsMap } from '@draftorb/shared';
import {
  championTagDrift,
  evaluateChampionTagsCoverage,
  formatCoverageReport,
  validateChampionTagsFile,
} from './tags';

// Committed copy of the latest exported champions catalog (Data Dragon derived,
// kept whole — ~22 KB). data/public is gitignored (D-079), so tests must never
// read it; `pnpm etl check-tags` drift-checks the live tags file against the
// freshly fetched catalog instead.
const CHAMPIONS_FIXTURE = path.resolve(__dirname, '../test/fixtures/champions.json');

describe('champion tags coverage and validation', () => {
  const mockChampions: ChampionsMap = {
    '1': { id: 1, name: 'Annie', icon: 'Annie.png', roles: ['MID', 'SUPPORT'] },
    '12': { id: 12, name: 'Alistar', icon: 'Alistar.png', roles: ['TOP', 'SUPPORT'] },
    '24': { id: 24, name: 'Jax', icon: 'Jax.png', roles: ['TOP'] },
    '80': { id: 80, name: 'Pantheon', icon: 'Pantheon.png', roles: ['TOP', 'MID'] },
  };

  const mockTags: ChampionTagsMap = {
    '1': {
      championId: 1,
      damageType: 'AP',
      archetype: 'mage',
      hardEngage: true,
      peel: true,
      poke: true,
      waveclear: true,
      scaling: { early: false, mid: true, late: true },
      range: 'RANGED',
      ccCount: 1,
    },
    '12': {
      championId: 12,
      damageType: 'AP',
      archetype: 'engage',
      hardEngage: true,
      peel: true,
      poke: false,
      waveclear: false,
      scaling: { early: true, mid: true, late: true },
      range: 'MELEE',
      ccCount: 3,
    },
    '80': {
      championId: 80,
      damageType: 'AD',
      archetype: 'assassin',
      hardEngage: true,
      peel: true,
      poke: true,
      waveclear: true,
      scaling: { early: true, mid: false, late: false },
      range: 'MELEE',
      ccCount: 2,
    },
  };

  it('evaluates coverage correctly when all supports and a flex pick are tagged', () => {
    const report = evaluateChampionTagsCoverage(mockTags, mockChampions);

    expect(report.totalChampions).toBe(4);
    expect(report.taggedCount).toBe(3);
    expect(report.totalSupportCount).toBe(2);
    expect(report.taggedSupportCount).toBe(2);
    expect(report.supportCoveragePercent).toBe(100);
    expect(report.overallCoveragePercent).toBe(75);
    expect(report.missingSupports).toEqual([]);
    expect(report.flexPicks).toEqual([{ id: 80, name: 'Pantheon', roles: ['TOP', 'MID'] }]);
    expect(report.untaggedChampions).toEqual([{ id: 24, name: 'Jax', roles: ['TOP'] }]);
  });

  it('detects missing supports when a support champion lacks tags', () => {
    // Only Annie tagged, Alistar missing
    const annieTag = mockTags['1'];
    expect(annieTag).toBeDefined();
    if (!annieTag) {
      throw new Error('Missing mock tag for Annie');
    }
    const partialTags: ChampionTagsMap = {
      '1': annieTag,
    };

    const report = evaluateChampionTagsCoverage(partialTags, mockChampions);

    expect(report.totalSupportCount).toBe(2);
    expect(report.taggedSupportCount).toBe(1);
    expect(report.supportCoveragePercent).toBe(50);
    expect(report.missingSupports).toEqual([
      { id: 12, name: 'Alistar', roles: ['TOP', 'SUPPORT'] },
    ]);
    expect(report.untaggedChampions).toHaveLength(3);
  });

  it('formats coverage report cleanly into readable text', () => {
    const report = evaluateChampionTagsCoverage(mockTags, mockChampions);
    const text = formatCoverageReport(report);

    expect(text).toContain('CHAMPION TAGS COVERAGE REPORT');
    expect(text).toContain('Support role champions:     2/2 (100%)');
    expect(text).toContain('Pantheon');
    expect(text).toContain('Jax');
    expect(text).toContain('All required support champions are tagged!');
  });

  it('validates the committed champion-tags.json against the champions fixture', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const result = await validateChampionTagsFile({
      championsFilePath: CHAMPIONS_FIXTURE,
      repoRoot,
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.coverage.taggedCount).toBeGreaterThanOrEqual(70);
    expect(result.coverage.totalSupportCount).toBeGreaterThan(0);
    expect(result.coverage.taggedSupportCount).toBe(result.coverage.totalSupportCount);
    expect(result.coverage.supportCoveragePercent).toBe(100);
    expect(result.coverage.missingSupports).toHaveLength(0);
    expect(result.coverage.flexPicks.length).toBeGreaterThan(0);
  });

  it('reports errors and empty coverage for a malformed champions catalog', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const invalidChampionsPath = path.join(
      repoRoot,
      'data',
      'manual',
      'test-malformed-champions.json',
    );

    // 'BOGUS' is not a valid Role, so the champions catalog fails schema validation.
    await fs.writeFile(
      invalidChampionsPath,
      JSON.stringify({
        '1': { id: 1, name: 'Annie', icon: 'Annie.png', roles: ['BOGUS'] },
      }),
      'utf8',
    );
    try {
      const result = await validateChampionTagsFile({
        championsFilePath: invalidChampionsPath,
        repoRoot,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes('Champions schema error'))).toBe(true);
      // Coverage is computed over the empty fallback, so it reports no champions
      // and does NOT falsely claim 100% support coverage.
      expect(result.coverage.totalChampions).toBe(0);
      expect(result.coverage.supportCoveragePercent).toBe(0);
      expect(result.coverage.overallCoveragePercent).toBe(0);
      expect(formatCoverageReport(result.coverage)).not.toContain(
        'All required support champions are tagged!',
      );
    } finally {
      await fs.unlink(invalidChampionsPath).catch(() => {});
    }
  });

  it('reports errors when validating invalid tags data or missing files', async () => {
    await expect(
      validateChampionTagsFile({
        tagsFilePath: '/nonexistent/path/champion-tags.json',
        championsFilePath: CHAMPIONS_FIXTURE,
      }),
    ).rejects.toThrow('Failed to read tags file');

    // Test with temporary invalid tags file
    const tmpDir = path.resolve(__dirname, '../../../data/manual');
    const invalidPath = path.join(tmpDir, 'test-invalid-tags.json');

    // Missing required fields
    await fs.writeFile(
      invalidPath,
      JSON.stringify({
        '1': { championId: 1, damageType: 'INVALID' },
      }),
      'utf8',
    );

    try {
      const repoRoot = path.resolve(__dirname, '../../..');
      const result = await validateChampionTagsFile({
        tagsFilePath: invalidPath,
        championsFilePath: CHAMPIONS_FIXTURE,
        repoRoot,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('Schema error'))).toBe(true);
    } finally {
      await fs.unlink(invalidPath).catch(() => {});
    }
  });

  it('reports no drift when tags cover every support and only known champions', () => {
    const drift = championTagDrift(mockTags, mockChampions);

    // Jax is untagged but not a support: drift only tracks the support contract.
    expect(drift).toEqual({ missingSupports: [], unknownTagIds: [] });
  });

  it('reports support champions missing tags and tag ids absent from the catalog', () => {
    const annieTag = mockTags['1'];
    if (!annieTag) {
      throw new Error('Missing mock tag for Annie');
    }
    const { '12': _alistar, ...withoutAlistar } = mockTags;
    const drift = championTagDrift(
      {
        ...withoutAlistar,
        '999': { ...annieTag, championId: 999 },
      },
      mockChampions,
    );

    expect(drift.missingSupports).toEqual([{ id: 12, name: 'Alistar', roles: ['TOP', 'SUPPORT'] }]);
    expect(drift.unknownTagIds).toEqual([999]);
  });
});
