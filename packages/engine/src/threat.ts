/**
 * @draftorb/engine — Threat score per enemy player (SPECS §8.2 step 2, T-053).
 *
 * Pure, deterministic. For every enemy `PlayerState` of a `GameState`:
 *
 *   threat = a * (K + 0.5*A) / (D + 1)
 *          + b * itemGold / avgItemGold(time)
 *          + c * scalingFactor(champion)
 *
 * `threatShare(e) = threat(e) / sum threat` feeds the `mid`-phase influence
 * weights (D-020) and the fed-enemy detection of the item recommender (T-054).
 *
 * Interpretations fixed in D-081 (PROPOSED): `itemGold` sums `goldTotal` of
 * catalog-known items; `avgItemGold(time)` is a piecewise-linear prior curve
 * from `ThreatConfig` (0 when the curve is 0, e.g. t = 0); `scalingFactor`
 * is the max of the champion tag's true `scaling` flags, neutral when untagged.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import type { ChampionTagsMap, ItemsMap, PlayerState } from '@draftorb/shared';
import { DEFAULT_THREAT_CONFIG } from './config.js';
import type { ThreatConfig } from './config.js';

export interface ThreatResult {
  /** Threat per enemy, aligned with the input order. */
  readonly threats: readonly number[];
  /** `threat / sum(threat)` per enemy; all zeros when the sum is not positive. */
  readonly shares: readonly number[];
}

/** `avgItemGold(time)`: piecewise-linear interpolation over the config anchors. */
export function avgItemGold(timeSeconds: number, config: ThreatConfig): number {
  const anchors = config.avgItemGoldAnchors;
  if (anchors.length === 0) return 0;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (timeSeconds <= first[0]) return first[1];
  if (timeSeconds >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const next = anchors[i];
    if (prev === undefined || next === undefined) continue;
    if (timeSeconds <= next[0]) {
      const span = next[0] - prev[0];
      if (span <= 0) return next[1];
      const t = (timeSeconds - prev[0]) / span;
      return prev[1] + t * (next[1] - prev[1]);
    }
  }
  return last[1];
}

/** Total gold value of the player's items known to the catalog (unknown ids ignored). */
function itemGold(player: PlayerState, items: ItemsMap): number {
  let gold = 0;
  for (const id of player.items) {
    gold += items[String(id)]?.goldTotal ?? 0;
  }
  return gold;
}

/**
 * Champion scaling factor (SPECS §8.2.2 `scalingFactor(champion)`): the max of
 * the tag's true `scaling` flags (`early`/`mid`/`late` weights in config), or
 * the neutral factor when the champion has no tag or no flag set (D-081).
 */
export function scalingFactor(
  championId: number,
  tags: ChampionTagsMap | undefined,
  config: ThreatConfig,
): number {
  const scaling = tags?.[String(championId)]?.scaling;
  if (scaling === undefined) return config.scalingFactorNeutral;
  const candidates = [
    scaling.early ? config.scalingFactors.early : 0,
    scaling.mid ? config.scalingFactors.mid : 0,
    scaling.late ? config.scalingFactors.late : 0,
  ];
  const max = Math.max(...candidates);
  return max > 0 ? max : config.scalingFactorNeutral;
}

/**
 * Threat scores and shares for a list of enemy `PlayerState`s (SPECS §8.2.2).
 * `timeSeconds` is the `GameState.time`; `items` is the item catalog;
 * `tags` is the champion-tags map (optional — untagged champions get the
 * neutral scaling factor).
 */
export function computeThreatScores(
  enemies: readonly PlayerState[],
  timeSeconds: number,
  items: ItemsMap,
  tags: ChampionTagsMap | undefined,
  config: ThreatConfig = DEFAULT_THREAT_CONFIG,
): ThreatResult {
  const avgGold = avgItemGold(timeSeconds, config);
  const threats = enemies.map((p) => {
    const kda = (p.kills + 0.5 * p.assists) / (p.deaths + 1);
    const goldTerm = avgGold > 0 ? itemGold(p, items) / avgGold : 0;
    return (
      config.kdaWeight * kda +
      config.itemGoldWeight * goldTerm +
      config.scalingWeight * scalingFactor(p.championId, tags, config)
    );
  });
  const total = threats.reduce((sum, t) => sum + t, 0);
  const shares = total > 0 ? threats.map((t) => t / total) : threats.map(() => 0);
  return { threats, shares };
}
