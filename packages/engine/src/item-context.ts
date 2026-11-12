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

// --- Raw-event replay helpers (D-082 Phase B) ---

/**
 * Raw item event as stored in `item_events` (ms timestamps, per-participant
 * `seq` ordering). `item_id` is the purchased/sold/destroyed item; for
 * `undo` rows it is `beforeId ?? afterId` and `before_id`/`after_id` carry
 * the undo payload.
 */
export interface ItemTimelineEvent {
  readonly ts: number;
  readonly seq: number;
  readonly event_type: 'purchase' | 'undo' | 'sold' | 'destroyed';
  readonly item_id: number;
  readonly before_id: number | null;
  readonly after_id: number | null;
}

function compareItemEvents(a: ItemTimelineEvent, b: ItemTimelineEvent): number {
  return a.ts - b.ts || a.seq - b.seq;
}

/**
 * Net purchased items after replaying the raw event stream (D-082: undo,
 * sold and destroyed all net out). Deterministic: identical input yields an
 * identical result. `destroyed` removes the item (support quest upgrades
 * destroy the quest item before granting the reward).
 */
export function netPurchasedItems(
  events: readonly ItemTimelineEvent[],
): ReadonlyMap<number, number> {
  const owned = new Map<number, number>();
  const sorted = [...events].sort(compareItemEvents);
  const add = (itemId: number, delta: number): void => {
    const next = (owned.get(itemId) ?? 0) + delta;
    if (next <= 0) owned.delete(itemId);
    else owned.set(itemId, next);
  };
  for (const event of sorted) {
    switch (event.event_type) {
      case 'purchase':
        add(event.item_id, 1);
        break;
      case 'sold':
      case 'destroyed':
        add(event.item_id, -1);
        break;
      case 'undo': {
        // ITEM_UNDO semantics: the purchase was undone. beforeId is the
        // item removed (the purchased one), afterId what replaced it (0 or
        // absent for a plain undo). When before_id is absent, fall back to
        // item_id.
        const removed = event.before_id ?? event.item_id;
        add(removed, -1);
        if (event.after_id !== null && event.after_id > 0) {
          add(event.after_id, 1);
        }
        break;
      }
    }
  }
  return owned;
}

/**
 * Items owned by `events` replayed up to and including `atMs`. Used for
 * enemy threat profiles at purchase time: only events at or before the
 * purchase timestamp count, so later game state cannot leak backwards.
 */
export function ownedItemsAt(
  events: readonly ItemTimelineEvent[],
  atMs: number,
): ReadonlyMap<number, number> {
  const prefix = events.filter((e) => e.ts <= atMs);
  return netPurchasedItems(prefix);
}

/**
 * Starter bundle key: the sorted, de-duplicated `"itemId:count"` pairs of
 * items purchased within `starterWindowSeconds` of game start, after netting
 * undo/sold/destroyed. Stable string form for grouping and exports.
 */
export function starterBundleKey(
  events: readonly ItemTimelineEvent[],
  windowSeconds: number,
  config: ItemContextConfig = DEFAULT_ITEM_CONTEXT_CONFIG,
): string {
  const windowMs = (windowSeconds > 0 ? windowSeconds : config.starterWindowSeconds) * 1000;
  const inWindow = events.filter((e) => e.ts <= windowMs);
  const owned = netPurchasedItems(inWindow);
  const parts = [...owned.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([itemId, count]) => `${itemId}:${count}`);
  return parts.join(',');
}

/**
 * Lane archetype key: collapses the exact lane matchup key to the most
 * influential slot's champion archetype so sparse exact keys back off to a
 * usable level. `laneKey` is the `lane:ALLY.champ|ENEMY.champ|...` form; the
 * first slot is the most influential (contextSlots ordering). Returns ''
 * when the key is empty or the champion has no archetype tag.
 */
export function laneArchKey(laneKey: string, tags: ChampionTagsMap | undefined): string {
  if (laneKey === '' || !laneKey.startsWith('lane:')) return '';
  const first = laneKey.slice('lane:'.length).split('|')[0];
  if (first === undefined) return '';
  // Slot format: "SIDE.ROLE:championId" (see aggregate-runes-context formatSlot).
  const championId = Number(first.split(':')[1]);
  if (!Number.isFinite(championId)) return '';
  const archetype = tags?.[String(championId)]?.archetype;
  return archetype === undefined || archetype === '' ? '' : archetype;
}

export type StateBucketMode = 'legacyAbsolute' | 'timeNormalized';

/**
 * State bucket with an explicit mode (D-082):
 *  - `legacyAbsolute`: the original fixed gold/kill thresholds.
 *  - `timeNormalized`: gold diff divided by the per-time-bucket standard
 *    deviation from `item_state_scale`; z >= `stateZAhead` => ahead,
 *    z <= -stateZAhead => behind, else even. Kill diff still uses the
 *    absolute thresholds. When `goldSd` is unavailable (no scale row or
 *    below the configured minimum) the function falls back to legacyAbsolute so
 *    sparse buckets never produce invented buckets.
 */
export function stateBucket(
  teamGoldDiff: number,
  killsDiff: number,
  config: ItemContextConfig,
  mode: StateBucketMode,
  goldSd?: number,
): ItemStateBucket {
  if (mode === 'timeNormalized' && goldSd !== undefined && goldSd > 0) {
    const z = teamGoldDiff / goldSd;
    if (z >= config.stateZAhead || killsDiff >= config.stateAheadKillsDiff) return 'ahead';
    if (z <= -config.stateZAhead || killsDiff <= -config.stateBehindKillsDiff) return 'behind';
    return 'even';
  }
  return itemStateBucket(teamGoldDiff, killsDiff, config);
}
