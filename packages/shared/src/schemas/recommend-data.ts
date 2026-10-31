/**
 * @draftorb/shared — Engine data input (`RecommendData`).
 *
 * The pre-loaded data objects the engine's `recommend` consumes (SPECS §5-7).
 * The engine never reads files: callers (web, desktop, tests) load and pass
 * these tables.
 */

import { z } from 'zod';

import { championIdSchema } from './core.js';
import { championRoleProbabilitiesSchema } from './champions.js';
import { championTagsMapSchema } from './tags.js';
import {
  allyPairTableSchema,
  baselineTableSchema,
  enemyPairTableSchema,
  laneFullTableSchema,
  laneVsTableSchema,
} from './tables.js';

export const recommendDataSchema = z
  .object({
    /** Baseline rows per (championId, bucket), role-specific. */
    baselines: baselineTableSchema,
    /** Ally pair rows per (championId, allyId, role, bucket). */
    allyPairs: allyPairTableSchema,
    /** Enemy pair rows per (championId, enemyId, role, bucket). */
    enemyPairs: enemyPairTableSchema,
    /** lane_vs rows per (championId, opp1Id, opp2Id, bucket). */
    laneVs: laneVsTableSchema,
    /** lane_full rows per (championId, partnerId, opp1Id, opp2Id, bucket). */
    laneFull: laneFullTableSchema,
    /** championId -> { role: prob }. */
    roleProb: championRoleProbabilitiesSchema,
    /** Champion tags for comp needs. */
    tags: championTagsMapSchema,
    /** Every known champion id (candidate enumeration and unknown-id checks). */
    championIds: z.array(championIdSchema),
  })
  .strict();
export type RecommendData = z.infer<typeof recommendDataSchema>;
