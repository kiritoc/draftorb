/**
 * @draftorb/engine — Influence matrix configuration (D-020).
 *
 * Role-relative influence weights for pair terms: `influence[myRole][side]
 * [otherRole]` per phase. Split out of config.ts (file size); pure move, no
 * logic change. The `mid` phase is derived at runtime by `getInfluence` using
 * `lambda` (D-020, SPECS §5/§103).
 */

import { z, roleSchema } from '@draftorb/shared';
import type { Role } from '@draftorb/shared';

export const SideSchema = z.enum(['ally', 'enemy']);
export type Side = z.infer<typeof SideSchema>;

export const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
export const SIDES: readonly Side[] = ['ally', 'enemy'];

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

export function createInfluenceMatrix(): InfluenceMatrix {
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
