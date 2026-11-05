/**
 * @draftorb/shared — Champion and role-probability schemas.
 *
 * `championRoleProbabilitiesSchema` is sparse: each champion entry lists only
 * the roles with non-zero probability (D-027). In zod 4, a sparse map requires
 * `z.partialRecord` instead of `z.record`, and probabilities must sum to 1
 * per champion (tolerance 1e-6, D-027).
 */

import { z } from 'zod';

import { championIdSchema, roleSchema } from './core.js';

export const championSchema = z
  .object({
    id: championIdSchema,
    name: z.string().min(1),
    icon: z.string().min(1),
    roles: z.array(roleSchema).min(1).max(5),
  })
  .strict();
export type Champion = z.infer<typeof championSchema>;

export const championsMapSchema = z.record(z.string(), championSchema);
export type ChampionsMap = z.infer<typeof championsMapSchema>;

const ROLE_PROB_TOLERANCE = 1e-6;

const roleProbInnerSchema = z.partialRecord(roleSchema, z.number().finite().gt(0).max(1)).refine(
  (probs) => {
    const sum = Object.values(probs).reduce((acc, p) => acc + p, 0);
    return Math.abs(sum - 1) <= ROLE_PROB_TOLERANCE;
  },
  { message: 'Role probabilities must sum to 1 (tolerance 1e-6)' },
);

export const championRoleProbabilitiesSchema = z.record(z.string(), roleProbInnerSchema);
export type ChampionRoleProbabilities = z.infer<typeof championRoleProbabilitiesSchema>;

const PICK_RATE_TOLERANCE = 1e-6;

const pickRateRoleSchema = z.record(z.string(), z.number().finite().gt(0).max(1)).refine(
  (shares) => {
    const sum = Object.values(shares).reduce((acc, s) => acc + s, 0);
    return Math.abs(sum - 1) <= PICK_RATE_TOLERANCE;
  },
  { message: 'Pick shares per role must sum to 1 (tolerance 1e-6)' },
);

/**
 * Per-role pick shares (`pick-rate.json`, B-026): role -> championId -> share
 * of that role's picks. Sparse like roleProb: absent champions have share 0,
 * and shares within each role sum to 1 (tolerance 1e-6).
 */
export const pickRateSchema = z.partialRecord(roleSchema, pickRateRoleSchema);
export type PickRate = z.infer<typeof pickRateSchema>;
