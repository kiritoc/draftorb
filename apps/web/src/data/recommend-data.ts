import {
  allyPairTableSchema,
  baselineTableSchema,
  championRoleProbabilitiesSchema,
  championTagsMapSchema,
  enemyPairTableSchema,
  laneFullTableSchema,
  laneVsTableSchema,
  pickRateSchema,
  type Champion,
  type ChampionTagsMap,
  type RecommendData,
} from '@draftorb/shared';

export function createRecommendData(
  files: Readonly<Record<string, unknown>>,
  champions: readonly Champion[],
  tags: ChampionTagsMap,
): RecommendData {
  return {
    baselines: baselineTableSchema.parse(requiredFile(files, 'roles/SUPPORT/baseline.json')),
    allyPairs: allyPairTableSchema.parse(requiredFile(files, 'roles/SUPPORT/ally-pairs.json')),
    enemyPairs: enemyPairTableSchema.parse(requiredFile(files, 'roles/SUPPORT/enemy-pairs.json')),
    laneVs: laneVsTableSchema.parse(requiredFile(files, 'roles/SUPPORT/lane-vs.json')),
    laneFull: laneFullTableSchema.parse(requiredFile(files, 'roles/SUPPORT/lane-full.json')),
    roleProb: championRoleProbabilitiesSchema.parse(requiredFile(files, 'role-prob.json')),
    // Optional: exports predating pick-rate.json keep the roleProb fallback (B-026).
    ...(files['pick-rate.json'] !== undefined
      ? { pickRate: pickRateSchema.parse(files['pick-rate.json']) }
      : {}),
    tags: championTagsMapSchema.parse(tags),
    championIds: champions.map((champion) => champion.id),
  };
}

function requiredFile(files: Readonly<Record<string, unknown>>, path: string): unknown {
  const file = files[path];
  if (file === undefined) {
    throw new Error(`Required recommendation data file is missing: ${path}`);
  }
  return file;
}
