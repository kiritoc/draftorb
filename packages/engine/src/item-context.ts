/**
 * @draftorb/engine — Item-purchase context rules (SPECS §8.2, D-020/D-022, T-051).
 *
 * Pure helpers shared by the ETL `item_build` aggregation and the item
 * recommenders: the `lane`/`mid` phase rule, the 5-minute purchase time
 * bucket, the `ahead`/`even`/`behind` state bucket and the threat-weighted
 * enemy damage profile. All thresholds come from `ItemContextConfig`
 * (priors until the D-023 gate).
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import type { ChampionTagsMap } from '@draftorb/shared';

import { DEFAULT_ITEM_CONTEXT_CONFIG } from './config.js';
import type { ItemContextConfig } from './config.js';

export type ItemStateBucket = 'ahead' | 'even' | 'behind';
export type ItemPhase = 'lane' | 'mid';
export type ItemProfileKey = 'AD' | 'AP' | 'mixed';

/**
 * Purchase time bucket label (SPECS §8.2: buckets of 5 min). Returns a
 * minutes range like `"0-5"`, `"5-10"`, … so exports stay human-readable.
 * Negative timestamps clamp to the first bucket.
 */
export function itemTimeBucket(
  seconds: number,
  config: ItemContextConfig = DEFAULT_ITEM_CONTEXT_CONFIG,
): string {
  const bucketSeconds = config.timeBucketSeconds;
  const bucketMinutes = bucketSeconds / 60;
  const start = Math.floor(Math.max(0, seconds) / bucketSeconds) * bucketMinutes;
  const end = start + bucketMinutes;
  const fmt = (value: number): string =>
    Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${fmt(start)}-${fmt(end)}`;
}

/**
 * Game-state bucket at purchase time (SPECS §8.2 step 4, D-022): `ahead` when
 * the team gold diff reaches `stateAheadGoldDiff` OR the kill diff reaches
 * `stateAheadKillsDiff`; `behind` symmetrically; `even` otherwise. Either
 * signal alone is enough — gold and kills are OR-ed, not summed.
 */
export function itemStateBucket(
  teamGoldDiff: number,
  killsDiff: number,
  config: ItemContextConfig = DEFAULT_ITEM_CONTEXT_CONFIG,
): ItemStateBucket {
  if (teamGoldDiff >= config.stateAheadGoldDiff || killsDiff >= config.stateAheadKillsDiff) {
    return 'ahead';
  }
  if (teamGoldDiff <= -config.stateBehindGoldDiff || killsDiff <= -config.stateBehindKillsDiff) {
    return 'behind';
  }
  return 'even';
}

/**
 * Phase rule (D-020, one rule everywhere): `lane` = starting items (slot 0)
 * and completed item k = 1 bought before `laneEndSeconds`; `mid` otherwise.
 */
export function itemPhase(
  slotIdx: number,
  seconds: number,
  config: ItemContextConfig = DEFAULT_ITEM_CONTEXT_CONFIG,
): ItemPhase {
  if (slotIdx === 0) return 'lane';
  if (slotIdx === 1 && seconds < config.laneEndSeconds) return 'lane';
  return 'mid';
}

/**
 * Threat-weighted enemy damage profile (SPECS §8.2 step 3, D-022): each
 * enemy's damage type (`AD`/`AP`/`MIXED`; `NONE`/untagged carry no signal)
 * is weighted by its threat share. `MIXED` counts for both sides. The
 * profile is the heavier side; ties and no-signal teams are `mixed`.
 */
export function threatWeightedDamageProfile(
  enemies: readonly { championId: number; threatShare: number }[],
  tags: ChampionTagsMap | undefined,
): ItemProfileKey {
  let adWeight = 0;
  let apWeight = 0;
  for (const enemy of enemies) {
    const damageType = tags?.[String(enemy.championId)]?.damageType;
    if (damageType === 'AD') {
      adWeight += enemy.threatShare;
    } else if (damageType === 'AP') {
      apWeight += enemy.threatShare;
    } else if (damageType === 'MIXED') {
      adWeight += enemy.threatShare;
      apWeight += enemy.threatShare;
    }
  }
  if (adWeight > apWeight) return 'AD';
  if (apWeight > adWeight) return 'AP';
  return 'mixed';
}
