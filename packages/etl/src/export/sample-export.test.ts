/**
 * @draftorb/etl — Published sample export sanity check (B-052).
 *
 * `data/public/` is the sample dataset the web app and the desktop shell ship
 * with. A degenerate export (e.g. every baseline row below `minGames`) makes
 * every draft render empty lists, so this test loads the real published files
 * through the same schemas the web loader uses and asserts that `recommend`
 * returns at least one "Best overall" recommendation per exported role.
 */

import { readFileSync } from 'node:fs';

import { recommend } from '@draftorb/engine';
import {
  allyPairTableSchema,
  baselineTableSchema,
  championRoleProbabilitiesSchema,
  championTagsMapSchema,
  championsMapSchema,
  enemyPairTableSchema,
  laneFullTableSchema,
  laneVsTableSchema,
  latestSchema,
  manifestSchema,
  pickRateSchema,
  type ChampionId,
  type RecommendData,
  type Role,
} from '@draftorb/shared';
import { describe, expect, it } from 'vitest';

const PUBLIC_DIR = new URL('../../../../data/public/', import.meta.url);
const CHAMPION_TAGS_PATH = new URL('../../../../data/manual/champion-tags.json', import.meta.url);

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

function requiredFile(files: Readonly<Record<string, unknown>>, path: string): unknown {
  const file = files[path];
  if (file === undefined) {
    throw new Error(`Required export file is missing: ${path}`);
  }
  return file;
}

/** Load the published export (latest.json -> manifest -> listed files). */
function loadPublishedExport(): {
  patch: string;
  roles: readonly Role[];
  files: Record<string, unknown>;
} {
  const latest = latestSchema.parse(readJson(new URL('latest.json', PUBLIC_DIR)));
  const manifest = manifestSchema.parse(readJson(new URL(latest.manifest, PUBLIC_DIR)));
  const files: Record<string, unknown> = {};
  for (const file of manifest.files) {
    files[file.path] = readJson(new URL(`${manifest.patch}/${file.path}`, PUBLIC_DIR));
  }
  return { patch: manifest.patch, roles: manifest.roles, files };
}

/** Build the engine input for one exported role, mirroring the web loader. */
function recommendDataForRole(
  role: Role,
  files: Readonly<Record<string, unknown>>,
  championIds: readonly ChampionId[],
  tags: ReturnType<typeof championTagsMapSchema.parse>,
): RecommendData {
  const req = (path: string): unknown => requiredFile(files, path);
  return {
    baselines: baselineTableSchema.parse(req(`roles/${role}/baseline.json`)),
    allyPairs: allyPairTableSchema.parse(req(`roles/${role}/ally-pairs.json`)),
    enemyPairs: enemyPairTableSchema.parse(req(`roles/${role}/enemy-pairs.json`)),
    laneVs: laneVsTableSchema.parse(req(`roles/${role}/lane-vs.json`)),
    laneFull: laneFullTableSchema.parse(req(`roles/${role}/lane-full.json`)),
    roleProb: championRoleProbabilitiesSchema.parse(req('role-prob.json')),
    ...(files['pick-rate.json'] !== undefined
      ? { pickRate: pickRateSchema.parse(files['pick-rate.json']) }
      : {}),
    tags,
    championIds: [...championIds],
  };
}

describe('published sample export (data/public)', () => {
  const { patch, roles, files } = loadPublishedExport();
  const champions = championsMapSchema.parse(
    readJson(new URL(`${patch}/champions.json`, PUBLIC_DIR)),
  );
  const championIds = Object.values(champions).map((champion) => champion.id);
  const tags = championTagsMapSchema.parse(readJson(CHAMPION_TAGS_PATH));

  it('lists at least one role', () => {
    expect(roles.length).toBeGreaterThan(0);
  });

  for (const role of roles) {
    it(`returns a non-empty "Best overall" list for ${role} at Diamond`, () => {
      const data = recommendDataForRole(role, files, championIds, tags);
      const result = recommend(
        { userRank: 'DIAMOND', userRole: role, allies: [], enemies: [], blindPick: true },
        data,
      );
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  }
});
