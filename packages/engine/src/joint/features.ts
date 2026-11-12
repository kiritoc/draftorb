/**
 * @draftorb/engine — Joint regularized draft model (T-123, D-092 PROPOSED).
 *
 * Replaces the layered heuristic log-odds terms with coefficients fitted
 * jointly by logistic regression on stored matches. One training row per
 * match, viewed from team 1's perspective:
 *
 *   logit P(team1 wins) =
 *     Σ mains[role:champ]   (team1 +, team2 −)
 *   + Σ allyPair[a:b]       (pairs inside team1 +, inside team2 −)
 *   + Σ enemyPair[a:b]      (ordered: team1 champ first)
 *   + Σ laneVs[a:b]         (enemyPair where both share the same role)
 *
 * The parameterization is antisymmetric under team swap by construction.
 * All coefficients are sparse logit contributions; candidates are ranked by
 * their candidate-dependent terms only (constant draft terms cancel).
 */

import type { ChampionId, Role } from '@draftorb/shared';

export type JointLayer = 'champMain' | 'allyPair' | 'enemyPair' | 'laneVs';

/** Sparse coefficient tables; absent key = 0 (no invented statistics). */
export interface JointModelParams {
  readonly version: 1;
  readonly bias: number;
  readonly champMain: Readonly<Record<string, number>>;
  readonly allyPair: Readonly<Record<string, number>>;
  readonly enemyPair: Readonly<Record<string, number>>;
  readonly laneVs: Readonly<Record<string, number>>;
  readonly l2: number;
  readonly iterations: number;
  readonly learningRate: number;
}

export interface JointFitConfig {
  readonly l2: number;
  readonly iterations: number;
  readonly learningRate: number;
}

export const DEFAULT_JOINT_FIT_CONFIG: JointFitConfig = {
  l2: 0.01,
  iterations: 80,
  learningRate: 0.2,
};

/** One player slot inside a match row or a draft context. */
export interface JointSlot {
  readonly championId: ChampionId;
  readonly role: Role;
  /** 'ally' = same team as the scored side, 'enemy' = opposing team. */
  readonly side: 'ally' | 'enemy';
}

/** A single sparse feature: coefficient lookup in `layer` at `key`, signed. */
export interface JointFeature {
  readonly layer: JointLayer;
  readonly key: string;
  readonly sign: 1 | -1;
}

export function champMainKey(role: Role, championId: ChampionId): string {
  return `${role}:${championId}`;
}

export function pairKey(a: ChampionId, b: ChampionId): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function laneGroupOf(role: Role): string {
  return role;
}

/**
 * Features contributed by one player relative to the scored side.
 * `side` is the team the logit is computed for; the player's own side
 * determines the sign of main and ally-pair terms.
 */
export function playerFeatures(slot: JointSlot): JointFeature[] {
  const sign: 1 | -1 = slot.side === 'ally' ? 1 : -1;
  return [{ layer: 'champMain', key: champMainKey(slot.role, slot.championId), sign }];
}

/**
 * All features of a full draft context (both teams) relative to `allySide`.
 * Used for match-level fitting and absolute logits; candidate scoring uses
 * `candidateFeatures` for the delta only.
 */
export function contextFeatures(
  allySlots: readonly JointSlot[],
  enemySlots: readonly JointSlot[],
): JointFeature[] {
  const features: JointFeature[] = [];
  for (const slot of allySlots) features.push(...playerFeatures(slot));
  for (const slot of enemySlots) features.push(...playerFeatures({ ...slot, side: 'enemy' }));

  const pushPairs = (slots: readonly JointSlot[], sign: 1 | -1): void => {
    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        features.push({
          layer: 'allyPair',
          key: pairKey(slots[i]!.championId, slots[j]!.championId),
          sign,
        });
      }
    }
  };
  pushPairs(allySlots, 1);
  pushPairs(enemySlots, -1);

  for (const a of allySlots) {
    for (const e of enemySlots) {
      features.push({
        layer: 'enemyPair',
        key: `${a.championId}:${e.championId}`,
        sign: 1,
      });
      if (laneGroupOf(a.role) === laneGroupOf(e.role)) {
        features.push({
          layer: 'laneVs',
          key: `${a.championId}:${e.championId}`,
          sign: 1,
        });
      }
    }
  }
  return features;
}

/**
 * Candidate-dependent features for scoring champion `c` in `role` on the
 * ally side against the known draft. Constant terms (pairs not involving
 * `c`) are omitted — they cancel in every comparison and in softmaxes.
 */
export function candidateFeatures(
  role: Role,
  championId: ChampionId,
  allySlots: readonly JointSlot[],
  enemySlots: readonly JointSlot[],
): JointFeature[] {
  const features: JointFeature[] = [
    { layer: 'champMain', key: champMainKey(role, championId), sign: 1 },
  ];
  for (const ally of allySlots) {
    features.push({
      layer: 'allyPair',
      key: pairKey(championId, ally.championId),
      sign: 1,
    });
  }
  for (const enemy of enemySlots) {
    const key = `${championId}:${enemy.championId}`;
    features.push({ layer: 'enemyPair', key, sign: 1 });
    if (laneGroupOf(role) === laneGroupOf(enemy.role)) {
      features.push({ layer: 'laneVs', key, sign: 1 });
    }
  }
  return features;
}

export function featureCoef(params: JointModelParams, feature: JointFeature): number {
  const table = params[feature.layer];
  return table[feature.key] ?? 0;
}

export function featuresLogit(params: JointModelParams, features: readonly JointFeature[]): number {
  let sum = params.bias;
  for (const feature of features) {
    sum += feature.sign * featureCoef(params, feature);
  }
  return sum;
}

/** Candidate logit deltas relative to an empty candidate slot. */
export function candidateLogits(
  params: JointModelParams,
  role: Role,
  championIds: readonly ChampionId[],
  allySlots: readonly JointSlot[],
  enemySlots: readonly JointSlot[],
): Map<ChampionId, number> {
  const logits = new Map<ChampionId, number>();
  for (const championId of championIds) {
    logits.set(
      championId,
      featuresLogit(params, candidateFeatures(role, championId, allySlots, enemySlots)),
    );
  }
  return logits;
}
