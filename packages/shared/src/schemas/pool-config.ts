/**
 * @draftorb/shared — Pool file schema (D-114, D-118, SPECS §19.3).
 *
 * `data/pool.config.json` is the public, committed copy of the user's champion
 * pool (champion x roles). The desktop program stores its own pool in the same
 * shape, so export is serialization and import is parsing.
 */

import { z } from 'zod';

import { championIdSchema, roleSchema } from './core.js';

export const POOL_CONFIG_SCHEMA_VERSION = 1;
export const POOL_CONFIG_MAX_PER_ROLE = 40;

export const poolConfigEntrySchema = z
  .object({
    championId: championIdSchema,
    /** Display text only; the id is authoritative. */
    name: z.string().min(1).optional(),
  })
  .strict();
export type PoolConfigEntry = z.infer<typeof poolConfigEntrySchema>;

const rolePoolSchema = z
  .array(poolConfigEntrySchema)
  .max(POOL_CONFIG_MAX_PER_ROLE)
  .refine((entries) => new Set(entries.map((e) => e.championId)).size === entries.length, {
    message: 'duplicate champion ids are not allowed in a role pool',
  });

export const poolConfigSchema = z
  .object({
    schemaVersion: z.literal(POOL_CONFIG_SCHEMA_VERSION),
    pools: z.partialRecord(roleSchema, rolePoolSchema),
  })
  .strict();
export type PoolConfig = z.infer<typeof poolConfigSchema>;
