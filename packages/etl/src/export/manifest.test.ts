import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
import { seed, supportBaselineRow, validPerksJson } from './export.fixtures.js';
import { createExportTestSuite, FIXED_NOW, PATCH } from './export.test-utils.js';
import { gzipSize } from './io.js';

const suite = createExportTestSuite();

describe('exportJson', () => {
  it('warns precisely above a file gzip-size boundary (B3)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    const roleProbContent = JSON.stringify({ '412': { SUPPORT: 1 } });
    const gzipBytes = gzipSize(roleProbContent);
    const atBoundary = suite.exportOnce({ maxFileBytes: gzipBytes });
    expect(atBoundary.warnings.some((warning) => warning.includes('role-prob.json'))).toBe(false);

    const belowBoundary = suite.exportOnce({ maxFileBytes: gzipBytes - 1 });
    expect(
      belowBoundary.warnings.filter((warning) => warning.includes('role-prob.json')),
    ).toHaveLength(1);
  });

  it('manifest: exact file set, sha256 per entry, schemaVersion, roles, rankBuckets, patch, generatedAt (B2, E5)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    seed(suite.db, 'baseline', [supportBaselineRow()]);
    const result = suite.exportOnce();
    const manifest = result.manifest;
    expect(manifest.schemaVersion).toBe(4);
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
      'item-classes.json',
      'pick-rate.json',
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
      const disk = readFileSync(join(suite.publicDir, PATCH, file.path), 'utf8');
      expect(createHash('sha256').update(disk, 'utf8').digest('hex')).toBe(file.sha256);
    }
  });

  it('retains static catalogs and role snapshots, hashing only the catalogs', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);

    const patchDir = join(suite.publicDir, PATCH);
    mkdirSync(patchDir, { recursive: true });
    const catalogs = {
      'champions.json': '{"412":{"id":412}}',
      'items.json': '{"1001":{"id":1001}}',
      'runes.json': '[{"id":8000}]',
    };
    const snapshots = {
      'champions.bootstrap.json': '{"bootstrap":true}',
      'champions.derived.json': '{"derived":true}',
    };
    for (const [name, content] of Object.entries({ ...catalogs, ...snapshots })) {
      writeFileSync(join(patchDir, name), content, 'utf8');
    }

    const result = suite.exportOnce();

    for (const [name, content] of Object.entries({ ...catalogs, ...snapshots })) {
      expect(readFileSync(join(patchDir, name), 'utf8')).toBe(content);
    }
    const manifestFiles = new Map(result.manifest.files.map((file) => [file.path, file.sha256]));
    for (const [name, content] of Object.entries(catalogs)) {
      expect(manifestFiles.get(name)).toBe(
        createHash('sha256').update(content, 'utf8').digest('hex'),
      );
      expect(existsSync(join(patchDir, name))).toBe(true);
    }
    for (const name of Object.keys(snapshots)) {
      expect(manifestFiles.has(name)).toBe(false);
    }
  });

  it('schema round-trip: every exported file parses with the shared zod schemas (E6)', () => {
    seed(suite.db, 'match', [{}]);
    seed(suite.db, 'roleProb', [
      { championId: 412, role: 'SUPPORT', gamesW: 10, gamesW2: 10, prob: 1 },
    ]);
    for (const myRole of ['SUPPORT', 'MID'] as const) {
      seed(suite.db, 'baseline', [supportBaselineRow({ myRole })]);
      seed(suite.db, 'pairAlly', [
        {
          championId: 412,
          myRole,
          otherId: 21,
          otherRole: 'SUPPORT',
          rankBucket: 'IRON',
          gamesW: 10,
          gamesW2: 10,
          winsW: 7,
        },
      ]);
      seed(suite.db, 'pairEnemy', [
        {
          championId: 412,
          myRole,
          otherId: 22,
          otherRole: 'ADC',
          rankBucket: 'IRON',
          gamesW: 10,
          gamesW2: 10,
          winsW: 5,
        },
      ]);
      seed(suite.db, 'laneVs', [
        {
          championId: 412,
          myRole,
          opp1Id: 21,
          opp2Id: 26,
          rankBucket: 'IRON',
          gamesW: 10,
          gamesW2: 10,
          winsW: 5,
        },
      ]);
      seed(suite.db, 'laneFull', [
        {
          championId: 412,
          myRole,
          partnerId: 21,
          opp1Id: 26,
          opp2Id: 84,
          rankBucket: 'IRON',
          gamesW: 10,
          gamesW2: 10,
          winsW: 5,
        },
      ]);
      seed(suite.db, 'runeCtx', [
        {
          championId: 412,
          myRole,
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
      seed(suite.db, 'itemBuild', [
        {
          championId: 412,
          myRole,
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
    }

    suite.exportOnce({ roles: ['SUPPORT', 'MID'] });
    const base = join(suite.publicDir, PATCH);
    // Manifest.
    manifestSchema.parse(JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')));
    // Tuples.
    for (const role of ['SUPPORT', 'MID']) {
      baselineTableSchema.parse(suite.readFile(`roles/${role}/baseline.json`));
      allyPairTableSchema.parse(suite.readFile(`roles/${role}/ally-pairs.json`));
      enemyPairTableSchema.parse(suite.readFile(`roles/${role}/enemy-pairs.json`));
      laneVsTableSchema.parse(suite.readFile(`roles/${role}/lane-vs.json`));
      laneFullTableSchema.parse(suite.readFile(`roles/${role}/lane-full.json`));
      runeExportSchema.parse(suite.readFile(`roles/${role}/runes/412.json`));
      itemBuildExportSchema.parse(suite.readFile(`roles/${role}/builds/412.json`));
    }
    // Role-prob (sparse map summing to 1).
    championRoleProbabilitiesSchema.parse(suite.readFile('role-prob.json'));
    // Rune + build.
  });
});
