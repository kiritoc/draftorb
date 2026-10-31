/**
 * @draftorb/shared — Machine codes emitted by the engine and rendered by the
 * web `strings` module (D-030): comp need categories and recommendation warnings.
 */

import { z } from 'zod';

import { roleSchema } from './core.js';

export const compNeedCategorySchema = z.enum([
  'engage',
  'peel',
  'waveclear',
  'poke',
  'ad_damage',
  'ap_damage',
]);
export type CompNeedCategory = z.infer<typeof compNeedCategorySchema>;

/** Warning code prefix: `counteredBy:<ROLE>:<championId>`. */
export const COUNTERED_BY_WARNING = 'counteredBy';
/** Warning code for a pool champion below the roleProb threshold (D-024). */
export const OFF_ROLE_WARNING = 'offRole';

const COUNTERED_BY_PATTERN = new RegExp(
  // Champion id must be a positive integer (matches championIdSchema).
  `^${COUNTERED_BY_WARNING}:(${roleSchema.options.join('|')}):[1-9]\\d*$`,
);

export const warningCodeSchema = z.union([
  z.literal(OFF_ROLE_WARNING),
  z.string().regex(COUNTERED_BY_PATTERN),
]);
export type WarningCode = z.infer<typeof warningCodeSchema>;
