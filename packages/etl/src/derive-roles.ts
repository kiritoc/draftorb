/**
 * @draftorb/etl — Derive champion roles from observed role probabilities.
 *
 * `role-prob.json` (SPECS §4 / DATA_MODEL.md) is the authoritative source of
 * which roles a champion is played in: a sparse map
 * `{ [championId]: { SUPPORT: 0.92, ... } }` whose probabilities sum to 1 per
 * champion (D-027). Roles absent from a champion's entry have zero observed
 * probability. This module derives each champion's role list from the observed
 * probabilities, replacing the Data Dragon champion-tag bootstrap hint stored
 * in `champions.json.roles`. Champions without role-prob data keep their
 * existing (bootstrap) roles.
 */

import type { ChampionRoleProbabilities, ChampionsMap, Role } from '@draftorb/shared';
import { roleSchema } from '@draftorb/shared';
import { DEFAULT_RECOMMEND_CONFIG } from '@draftorb/engine';

/** All roles in canonical order (matches `roleSchema` enum order). */
export const CANONICAL_ROLES: readonly Role[] = roleSchema.options as unknown as readonly Role[];

/**
 * Derives the roles of every champion observed in `roleProbabilities`.
 *
 * A champion's roles are the roles with probability >= `minProb`
 * (`roleProbThreshold`, B-046), in canonical order. Champions absent from the
 * map are not included — callers keep their existing (bootstrap) roles for
 * unobserved champions.
 */
export function deriveChampionRoles(
  roleProbabilities: ChampionRoleProbabilities,
  minProb: number = DEFAULT_RECOMMEND_CONFIG.roleProbThreshold,
): Record<string, Role[]> {
  const result: Record<string, Role[]> = {};
  for (const [championId, probs] of Object.entries(roleProbabilities)) {
    const roles: Role[] = [];
    for (const role of CANONICAL_ROLES) {
      if ((probs[role] ?? 0) >= minProb) {
        roles.push(role);
      }
    }
    if (roles.length === 0) {
      // Cannot happen with five roles summing to 1, but a champion must always
      // keep at least one role: fall back to the highest-probability one.
      const best = CANONICAL_ROLES.reduce((a, b) => ((probs[b] ?? 0) > (probs[a] ?? 0) ? b : a));
      roles.push(best);
    }
    result[championId] = roles;
  }
  return result;
}

/**
 * Applies derived roles to a champions map. Champions with an observed
 * role-probability entry get their derived roles; all other champions keep
 * their existing roles (the Data Dragon tag bootstrap).
 */
export function applyDerivedRoles(
  champions: ChampionsMap,
  roleProbabilities: ChampionRoleProbabilities,
  minProb: number = DEFAULT_RECOMMEND_CONFIG.roleProbThreshold,
): ChampionsMap {
  const derived = deriveChampionRoles(roleProbabilities, minProb);
  const result: ChampionsMap = {};
  for (const [championId, champion] of Object.entries(champions)) {
    result[championId] = { ...champion, roles: derived[championId] ?? champion.roles };
  }
  return result;
}
