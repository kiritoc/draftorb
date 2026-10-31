/**
 * @draftorb/engine — Shared internal types for the recommendation engine.
 */

import type { ChampionId, ReasonLevel, Recommendation, Role } from '@draftorb/shared';

/** Reason type, derived from the shared output schema (never duplicated). */
type ReasonType = Recommendation['reasons'][number]['type'];

/** A known slot augmented with its inferred role and confidence. */
export interface KnownSlot {
  readonly championId: ChampionId;
  readonly role: Role;
  readonly side: 'ally' | 'enemy';
  readonly confidence: number;
  readonly fixed: boolean;
}

/** Equivalent-count row built from an exported table (SPECS §5). */
export interface DataRow {
  readonly winsW: number;
  readonly gamesW: number;
  readonly gamesW2: number;
  readonly winsE: number;
  readonly gamesE: number;
  readonly nE: number;
  /** Raw (unweighted) match count; set for baseline rows only. */
  readonly rawGames?: number;
}

/** Accumulator for reasons during scoring, before the final Reason is produced. */
export interface ReasonAccumulator {
  readonly type: ReasonType;
  readonly with: ChampionId[];
  readonly deltaPp: number;
  readonly n: number;
  readonly lowData: boolean;
  readonly level: ReasonLevel;
}

/** A lane-layer correction (lane_vs or lane_full). */
export interface LaneDelta {
  readonly term: number;
  readonly lowData: boolean;
  readonly n: number;
  readonly deltaPp: number;
}

// Lane groups are config (SPECS §5, D-021): defined in config.ts (DEFAULT_LANE_GROUPS).
export type { LaneGroup } from './config.js';

export interface LaneGroupInfo {
  readonly allies: KnownSlot[];
  readonly enemies: KnownSlot[];
  readonly alliesKnown: Role[];
  readonly enemiesKnown: Role[];
  /** conf_lane for lane_full: product over allies and enemies of the lane group. */
  readonly confidence: number;
  /** conf_lane for lane_vs: product over the lane-group enemies only. */
  readonly enemyConfidence: number;
}
