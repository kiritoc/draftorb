/**
 * @draftorb/shared — Game state schemas.
 *
 * `GameState` is the in-game snapshot used for item recommendations (SPECS §8.2).
 */

import { z } from 'zod';

import { championIdSchema, itemIdSchema } from './core.js';

export const playerStateSchema = z
  .object({
    championId: championIdSchema,
    kills: z.number().int().nonnegative(),
    deaths: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    cs: z.number().nonnegative().optional(),
    items: z.array(itemIdSchema).default([]),
    level: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PlayerState = z.infer<typeof playerStateSchema>;

export const gameStateSchema = z
  .object({
    time: z.number().nonnegative(),
    me: playerStateSchema,
    allies: z.array(playerStateSchema).max(4),
    enemies: z.array(playerStateSchema).max(5),
    goldDiff: z.number().optional(),
    kills: z.number().int().nonnegative().optional(),
    towers: z.number().int().nonnegative().optional(),
    dragons: z.number().int().nonnegative().optional(),
  })
  .strict();
export type GameState = z.infer<typeof gameStateSchema>;
