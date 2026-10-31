/**
 * @draftorb/engine — Rank weighting configuration.
 *
 * Config for the rank-distance kernel (SPECS §3), recency decay, reliability
 * down-weight, effective sample size, equivalent-count conversion, expert
 * filtering, and the role-relative influence matrix (D-020). All defaults are
 * priors from SPECS §3/§5; each scalar is calibrated by the D-023 backtest.
 */

import { z, roleSchema } from '@draftorb/shared';
import type { Rank, RankBucket, Role } from '@draftorb/shared';

// --- Engine-specific enums (not in shared) ---

export const PhaseSchema = z.enum(['draft', 'lane', 'mid']);
export type Phase = z.infer<typeof PhaseSchema>;

export const SideSchema = z.enum(['ally', 'enemy']);
export type Side = z.infer<typeof SideSchema>;

// --- Constants ---

export const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
export const SIDES: readonly Side[] = ['ally', 'enemy'];

export const RANK_BUCKET_ORDER: readonly RankBucket[] = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER_PLUS',
];

// --- Rank helpers ---

/** Map a raw 10-tier Rank to the 8 SPECS §3 rank buckets (MASTER+ merge). */
export function rankToBucket(rank: Rank): RankBucket {
  if (rank === 'MASTER' || rank === 'GRANDMASTER' || rank === 'CHALLENGER') {
    return 'MASTER_PLUS';
  }
  return rank;
}

/** Numeric index of a rank bucket: IRON=0 … MASTER_PLUS=7. */
export function bucketIndex(bucket: RankBucket): number {
  return RANK_BUCKET_ORDER.indexOf(bucket);
}

// --- Influence matrix ---

/** A single cell: a weight in [0, 1], or null for an omitted slot (ally self-role). */
const influenceCellSchema = z.number().finite().min(0).max(1).nullable();

/** One row of the matrix: all 5 roles present (zod 4 record requires every enum key). */
const influenceRowSchema = z.record(roleSchema, influenceCellSchema);

const influenceSideSchema = z.record(SideSchema, influenceRowSchema);

const influencePhaseMatrixSchema = z.record(roleSchema, influenceSideSchema);

/** `influence[myRole][side][otherRole]` for one phase. */
export type InfluenceMatrix = z.infer<typeof influencePhaseMatrixSchema>;

/**
 * Influence matrix for the stored phases (draft, lane). The `mid` phase is
 * derived at runtime by `getInfluence` using `lambda` (D-020, SPECS §5/§103).
 *
 * Invariants validated here:
 * - ally row: the self-role cell must be null; the other 4 must be numeric.
 * - enemy row: all 5 cells must be numeric; the self-role (direct opponent)
 *   cell must be the row maximum.
 */
export const influenceConfigSchema = z
  .object({
    draft: influencePhaseMatrixSchema,
    lane: influencePhaseMatrixSchema,
  })
  .superRefine((matrix, ctx) => {
    for (const phase of ['draft', 'lane'] as const) {
      const phaseMatrix = matrix[phase];
      for (const myRole of ROLES) {
        const sides = phaseMatrix[myRole];
        if (sides === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `influence matrix: missing row for ${myRole}`,
            path: [phase, myRole],
          });
          continue;
        }
        for (const side of SIDES) {
          const row = sides[side];
          if (row === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `influence matrix: missing ${side} row for ${myRole}`,
              path: [phase, myRole, side],
            });
            continue;
          }

          if (side === 'ally') {
            // Self-role must be null (omitted); others must be numeric.
            if (row[myRole] !== null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `ally row for ${myRole}: self-role cell must be null (omitted)`,
                path: [phase, myRole, side, myRole],
              });
            }
            for (const otherRole of ROLES) {
              if (otherRole !== myRole && row[otherRole] === null) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `ally row for ${myRole}: cell for ${otherRole} must be numeric`,
                  path: [phase, myRole, side, otherRole],
                });
              }
            }
          } else {
            // Enemy: all 5 must be numeric; self-role (opponent) must be the row max.
            for (const otherRole of ROLES) {
              if (row[otherRole] === null) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `enemy row for ${myRole}: cell for ${otherRole} must be numeric`,
                  path: [phase, myRole, side, otherRole],
                });
              }
            }
            const selfVal = row[myRole];
            if (selfVal !== null && selfVal !== undefined) {
              for (const otherRole of ROLES) {
                const v = row[otherRole];
                if (v !== null && v !== undefined && v > selfVal) {
                  ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `enemy row for ${myRole}: opponent cell must be the row maximum`,
                    path: [phase, myRole, side, otherRole],
                  });
                  break;
                }
              }
            }
          }
        }
      }
    }
  });

export type InfluenceConfig = z.infer<typeof influenceConfigSchema>;

// --- Default influence matrix (SPECS §5 table, shared by draft & lane) ---

function createInfluenceMatrix(): InfluenceMatrix {
  return {
    SUPPORT: {
      ally: { TOP: 0.2, JUNGLE: 0.6, MID: 0.3, ADC: 1.0, SUPPORT: null },
      enemy: { TOP: 0.1, JUNGLE: 0.4, MID: 0.2, ADC: 0.9, SUPPORT: 1.0 },
    },
    ADC: {
      ally: { TOP: 0.1, JUNGLE: 0.5, MID: 0.2, ADC: null, SUPPORT: 1.0 },
      enemy: { TOP: 0.1, JUNGLE: 0.4, MID: 0.2, ADC: 1.0, SUPPORT: 0.9 },
    },
    JUNGLE: {
      ally: { TOP: 0.5, JUNGLE: null, MID: 0.6, ADC: 0.4, SUPPORT: 0.5 },
      enemy: { TOP: 0.4, JUNGLE: 1.0, MID: 0.6, ADC: 0.3, SUPPORT: 0.4 },
    },
    MID: {
      ally: { TOP: 0.2, JUNGLE: 0.7, MID: null, ADC: 0.2, SUPPORT: 0.3 },
      enemy: { TOP: 0.2, JUNGLE: 0.6, MID: 1.0, ADC: 0.2, SUPPORT: 0.3 },
    },
    TOP: {
      ally: { TOP: null, JUNGLE: 0.6, MID: 0.2, ADC: 0.1, SUPPORT: 0.1 },
      enemy: { TOP: 1.0, JUNGLE: 0.6, MID: 0.2, ADC: 0.1, SUPPORT: 0.1 },
    },
  };
}

export const DEFAULT_INFLUENCE: InfluenceMatrix = createInfluenceMatrix();

// --- Full config schema ---

export const rankWeightingConfigSchema = z
  .object({
    tau: z.number().positive(),
    decay: z.number().gt(0).max(1),
    unknownRankFactor: z.number().gt(0).max(1),
    rankWindowTiers: z.number().int().nonnegative(),
    minGames: z.number().nonnegative(),
    highLevelMinGames: z.number().nonnegative(),
    k0: z.number().nonnegative(),
    k: z.number().nonnegative(),
    kLane: z.number().nonnegative(),
    s: z.number().nonnegative(),
    eps: z.number().gt(0).max(0.5),
    lambda: z.number().gte(0).max(1),
    contextSlots: z.number().int().min(1),
    minChampGames: z.number().nonnegative(),
    minMasteryPoints: z.number().int().nonnegative(),
    alpha: z.number().nonnegative(),
    wMax: z.number().gte(1),
    exportMinGames: z.number().nonnegative(),
    influence: influenceConfigSchema,
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.exportMinGames > config.minGames) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'exportMinGames must be <= minGames so every row that passes the scoring gate survives export',
        path: ['exportMinGames'],
      });
    }
    if (config.highLevelMinGames < config.minGames) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'highLevelMinGames must be >= minGames so L2/L3 never fire on lowData reasons',
        path: ['highLevelMinGames'],
      });
    }
  });

export type RankWeightingConfig = z.infer<typeof rankWeightingConfigSchema>;

export const DEFAULT_CONFIG: RankWeightingConfig = rankWeightingConfigSchema.parse({
  tau: 1.25,
  decay: 0.85,
  unknownRankFactor: 0.5,
  rankWindowTiers: 2,
  minGames: 25,
  highLevelMinGames: 100,
  k0: 20,
  k: 40,
  kLane: 40,
  s: 1.0,
  eps: 1e-4,
  lambda: 0.3,
  contextSlots: 3,
  minChampGames: 30,
  minMasteryPoints: 50000,
  alpha: 0.25,
  wMax: 2.0,
  exportMinGames: 10,
  influence: {
    draft: createInfluenceMatrix(),
    lane: createInfluenceMatrix(),
  },
});

// --- Role inference config (SPECS §4) ---

/**
 * Floor for probability in log-probability calculations to avoid -Infinity.
 * Used in role inference when computing log roleProb for assignments.
 */
export const ROLE_INFERENCE_EPS = 1e-4;

// --- Recommendation config (SPECS §5) ---

/** Role probability threshold to enter the candidate set (SPECS §5). */
export const ROLE_PROB_THRESHOLD = 0.05;

/** Prior win rate the baseline `p0` is shrunk toward (SPECS §5: k0 toward 0.5). */
export const BASELINE_PRIOR_WINRATE = 0.5;

/**
 * Tie quantum: scores are bucketed by `Math.round(score / SCORE_TIE_EPSILON)`
 * and equal buckets are ties, broken by championId ascending. Bucketing keeps
 * the comparator transitive; two scores closer than the quantum may still fall
 * in adjacent buckets (deterministic either way).
 */
export const SCORE_TIE_EPSILON = 1e-9;

/** Decimal places kept on a reported reason `deltaPp`. */
export const DELTA_PP_DECIMALS = 2;

/**
 * Lookup-key placeholder for an absent lane id (`opp2`/`partner` in 1v1 lane
 * groups); matches the `COALESCE(..., -1)` used by the lane unique indexes.
 */
export const MISSING_LANE_ID = -1;

/**
 * Gates used to level comp/blind reasons, which have no sample (SPECS §5): a
 * nominal n_eff of 1 with both gates at 0, so only the deltaPp thresholds apply.
 */
export const UNSAMPLED_LEVEL_NEFF = 1;
export const UNSAMPLED_LEVEL_MIN_GAMES = 0;
export const UNSAMPLED_LEVEL_HIGH_MIN_GAMES = 0;
/** Positive comp/blind levels are capped at this level (SPECS §5). */
export const UNSAMPLED_MAX_POSITIVE_LEVEL = 1;

/** W_comp: scale applied to the comp-need bonus (SPECS §5). Prior. */
export const W_COMP = 1.0;

/** W_blind: scale applied to blindSafety(c) (SPECS §5). Prior. */
export const W_BLIND = 1.0;

/** Weight of the worst-case (min) matchup penalty inside blindSafety (SPECS §5). Prior. */
export const BLIND_WORST_CASE_FACTOR = 0.5;

/**
 * A known enemy triggers a "countered by" warning when its shrunk pair term
 * moves the baseline by at most this many percentage points (L3 negative).
 */
export const HARD_COUNTER_DELTA_PP = -4.5;

/** Warning code prefix: `counteredBy:<ROLE>:<championId>` (rendered by the UI `strings` module). */
export const COUNTERED_BY_WARNING = 'counteredBy';

/**
 * Comp need weights (log-odds). Each value is the bonus contributed when the
 * champion is the first on the team to provide that need. Priors calibrated
 * by the D-023 backtest (T-027.a).
 */
export interface CompConfig {
  readonly engage: number;
  readonly peel: number;
  readonly waveclear: number;
  readonly poke: number;
  readonly adDamage: number;
  readonly apDamage: number;
  readonly missingThreshold: number;
  /** Minimum known allies before the AD/AP balance is evaluated. */
  readonly minAlliesForDamageMix: number;
}

export const DEFAULT_COMP_CONFIG: CompConfig = Object.freeze({
  engage: 0.1,
  peel: 0.1,
  waveclear: 0.08,
  poke: 0.06,
  adDamage: 0.1,
  apDamage: 0.1,
  missingThreshold: 0.5,
  minAlliesForDamageMix: 3,
});

// --- Influence lookup ---

export interface InfluenceOpts {
  threatShares?: Partial<Record<Role, number>>;
  enemiesKnown?: number;
}

/**
 * Look up the influence weight for a (myRole, side, otherRole, phase) cell.
 *
 * For `draft` and `lane` phases this is a direct table lookup. For the `mid`
 * phase (SPECS §8.2 / D-020), ally weights come from the lane row and enemy
 * weights are `lambda * lane + (1 - lambda) * threatShare(e) * enemiesKnown`.
 *
 * A null cell (omitted ally self-role) returns 0.
 */
export function getInfluence(
  myRole: Role,
  side: Side,
  otherRole: Role,
  phase: Phase,
  config: RankWeightingConfig,
  opts: InfluenceOpts = {},
): number {
  if (phase === 'mid') {
    const laneRow = config.influence.lane[myRole]?.[side]?.[otherRole];
    const laneWeight = laneRow === null || laneRow === undefined ? 0 : laneRow;

    if (side === 'ally') {
      return laneWeight;
    }

    const threatShare = opts.threatShares?.[otherRole] ?? 0;
    const enemiesKnown = opts.enemiesKnown ?? 0;
    return config.lambda * laneWeight + (1 - config.lambda) * threatShare * enemiesKnown;
  }

  const matrix = phase === 'draft' ? config.influence.draft : config.influence.lane;
  const cell = matrix[myRole]?.[side]?.[otherRole];
  return cell === null || cell === undefined ? 0 : cell;
}
