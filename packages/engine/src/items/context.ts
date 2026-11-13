/**
 * @draftorb/engine — Game-state → item-context derivation (SPECS §8.2
 * steps 3–5, T-125).
 *
 * Reproduces the dimensions the ETL `item_build` aggregation writes into
 * `roles/<ROLE>/builds/<championId>.json` contexts: `slotIdx`, `timeBucket`,
 * `stateBucket`, `profileKey`, `laneKey`/`laneArch`. Pure and deterministic.
 */

import type {
  ChampionId,
  ChampionTagsMap,
  GameState,
  ItemBuildProfileKey,
  ItemsMap,
  PlayerState,
  Role,
  StateScaleExport,
} from '@draftorb/shared';

import { DEFAULT_CONFIG, DEFAULT_ITEM_CONTEXT_CONFIG, DEFAULT_LANE_GROUPS, DEFAULT_THREAT_CONFIG, getInfluence } from '../config.js';
import type { ItemContextConfig, LaneGroup, RankWeightingConfig, ThreatConfig } from '../config.js';
import { itemPhase, itemTimeBucket, laneArchKey, stateBucket, threatWeightedDamageProfile } from '../item-context.js';
import type { ItemStateBucket } from '../item-context.js';
import { computeThreatScores } from '../threat.js';
import type { ItemsConfig } from './config.js';
import { DEFAULT_ITEMS_CONFIG } from './config.js';
import type { ItemContextLevel } from './types.js';

/** Role order for lane-context ties (same as runes-context / ETL). */
const ROLE_ORDER: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

/** Optional draft lane context: role-tagged champions around `me`. */
export interface ItemLaneContext {
  readonly allies: readonly { role: Role; championId: ChampionId }[];
  readonly enemies: readonly { role: Role; championId: ChampionId }[];
}

export interface ItemContext {
  /** Completed-item slot the next purchase lands in (0 = starting items). */
  readonly slotIdx: number;
  readonly timeBucket: string;
  readonly stateBucket: ItemStateBucket;
  readonly profileKey: ItemBuildProfileKey;
  /** `lane:...` key, only populated during the `lane` phase. */
  readonly laneKey: string;
  /** Lane-archetype backoff key (D-086), '' outside the lane phase. */
  readonly laneArch: string;
  readonly phase: 'lane' | 'mid';
  /** Threat shares per enemy (aligned with `enemies` input order). */
  readonly threatShares: readonly number[];
  /** Fed-enemy indices into the enemies array (top threat share >= fedShare). */
  readonly fedEnemyIdx: readonly number[];
}

/**
 * Count completed/boots items owned — mirrors the aggregator's
 * `ownedCompleted()` so the recommended slot matches the stored `slot_idx`.
 * Items unknown to `itemClasses` count as components (ignored).
 */
export function ownedCompletedCount(
  owned: readonly number[],
  itemClasses: ReadonlyMap<number, { cls: string }> | undefined,
): number {
  if (itemClasses === undefined) return owned.length;
  let n = 0;
  for (const id of owned) {
    const cls = itemClasses.get(id)?.cls;
    if (cls === 'completed' || cls === 'boots') n += 1;
  }
  return n;
}

/**
 * `lane:` context key in the exact `laneKeyOf` format: influence-sorted
 * `contextSlots` lane-group slots, `side.ROLE:champId` joined by `|`.
 * Returns '' when the lane context or champion tags are unavailable.
 */
export function itemLaneKey(
  myRole: Role,
  lane: ItemLaneContext | undefined,
  laneGroups: Readonly<Record<Role, LaneGroup>> | undefined,
  config: RankWeightingConfig,
): string {
  if (lane === undefined || laneGroups === undefined) return '';
  const group = laneGroups[myRole];
  if (group === undefined) return '';
  const candidates: {
    championId: ChampionId;
    role: Role;
    side: 'a' | 'e';
    influence: number;
    sideOrder: number;
    roleOrder: number;
  }[] = [];
  for (const role of group.allies) {
    const found = lane.allies.find((s) => s.role === role);
    if (found === undefined) continue;
    candidates.push({
      championId: found.championId,
      role,
      side: 'a',
      influence: getInfluence(myRole, 'ally', role, 'lane', config),
      sideOrder: 0,
      roleOrder: ROLE_ORDER.indexOf(role),
    });
  }
  for (const role of group.enemies) {
    const found = lane.enemies.find((s) => s.role === role);
    if (found === undefined) continue;
    candidates.push({
      championId: found.championId,
      role,
      side: 'e',
      influence: getInfluence(myRole, 'enemy', role, 'lane', config),
      sideOrder: 1,
      roleOrder: ROLE_ORDER.indexOf(role),
    });
  }
  candidates.sort(
    (a, b) =>
      b.influence - a.influence ||
      a.sideOrder - b.sideOrder ||
      a.roleOrder - b.roleOrder ||
      a.championId - b.championId,
  );
  const top = candidates.slice(0, config.contextSlots);
  if (top.length === 0) return '';
  return `lane:${top.map((s) => `${s.side}.${s.role}:${s.championId}`).join('|')}`;
}

/**
 * Derive the full item context for `state`. `goldDiff`/`kills` on GameState
 * are team diffs (SPECS §8.2); absent values count as 0 (`even` bucket).
 * `goldSd` comes from `state-scale.json` when `stateBucketMode` is
 * `timeNormalized` and the bucket clears `minStateMatches`.
 */
export function deriveItemContext(
  state: GameState,
  myRole: Role,
  opts: {
    itemClasses?: ReadonlyMap<number, { cls: string }>;
    items?: ItemsMap;
    championTags?: ChampionTagsMap;
    lane?: ItemLaneContext;
    stateScale?: StateScaleExport;
    itemConfig?: ItemContextConfig;
    rankConfig?: RankWeightingConfig;
    laneGroups?: Readonly<Record<Role, LaneGroup>>;
    threatConfig?: ThreatConfig;
    itemsConfig?: ItemsConfig;
  } = {},
): ItemContext {
  const itemConfig = opts.itemConfig ?? DEFAULT_ITEM_CONTEXT_CONFIG;
  const rankConfig = opts.rankConfig ?? DEFAULT_CONFIG;
  const threatConfig = opts.threatConfig ?? DEFAULT_THREAT_CONFIG;
  const itemsConfig = opts.itemsConfig ?? DEFAULT_ITEMS_CONFIG;

  const ownedIds = state.me.items.map(Number);
  const slotIdx = ownedCompletedCount(ownedIds, opts.itemClasses);
  const seconds = state.time;
  const phase = itemPhase(slotIdx, seconds, itemConfig);
  const timeBucket = itemTimeBucket(seconds, itemConfig);

  const goldDiff = state.goldDiff ?? 0;
  const killsDiff = state.kills ?? 0;
  let goldSd: number | undefined;
  if (itemsConfig.stateBucketMode === 'timeNormalized' && opts.stateScale !== undefined) {
    const entry = opts.stateScale.buckets.find((b) => b.timeBucket === timeBucket);
    if (entry !== undefined && entry.sampleCount >= itemConfig.minStateMatches) {
      goldSd = entry.goldSd;
    }
  }
  const sb = stateBucket(goldDiff, killsDiff, itemConfig, itemsConfig.stateBucketMode, goldSd);

  const enemies: PlayerState[] = state.enemies;
  const threat =
    opts.items !== undefined && enemies.length > 0
      ? computeThreatScores(enemies, seconds, opts.items, opts.championTags, threatConfig)
      : { threats: enemies.map(() => 0), shares: enemies.map(() => (enemies.length > 0 ? 1 / enemies.length : 0)) };
  const threatShares = threat.shares;

  // Enemy profile: threat-share-weighted damage mix (SPECS §8.2 step 3).
  const profileKey: ItemBuildProfileKey =
    enemies.length === 0
      ? 'unknown'
      : threatWeightedDamageProfile(
          enemies.map((p, i) => ({ championId: p.championId, threatShare: threatShares[i] ?? 0 })),
          opts.championTags,
        );

  // Fed enemies: threat share >= 1.5x the equal share (top-heavy teams).
  const equalShare = enemies.length > 0 ? 1 / enemies.length : 0;
  const fedEnemyIdx = threatShares
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => equalShare > 0 && s >= Math.max(0.34, equalShare * 1.5))
    .map(({ i }) => i);

  const laneKey =
    phase === 'lane'
      ? itemLaneKey(myRole, opts.lane, opts.laneGroups ?? DEFAULT_LANE_GROUPS, rankConfig)
      : '';
  const laneArch =
    laneKey !== '' && opts.championTags !== undefined ? laneArchKey(laneKey, opts.championTags) : '';

  return {
    slotIdx,
    timeBucket,
    stateBucket: sb,
    profileKey,
    laneKey,
    laneArch,
    phase,
    threatShares,
    fedEnemyIdx,
  };
}

/**
 * Ordered back-off levels for context matching (SPECS §8.2 step 7):
 * exact lane -> lane archetype -> enemy profile -> state -> time bucket ->
 * (champion, slot). Each level lists the dims that must match.
 */
export interface ContextLevelSpec {
  readonly level: ItemContextLevel;
  readonly useLaneKey: boolean;
  readonly useLaneArch: boolean;
  readonly useProfile: boolean;
  readonly useState: boolean;
  readonly useTime: boolean;
}

export const ITEM_CONTEXT_LEVELS: readonly ContextLevelSpec[] = [
  { level: 'laneExact', useLaneKey: true, useLaneArch: false, useProfile: true, useState: true, useTime: true },
  { level: 'laneArch', useLaneKey: false, useLaneArch: true, useProfile: true, useState: true, useTime: true },
  { level: 'profileStateTime', useLaneKey: false, useLaneArch: false, useProfile: true, useState: true, useTime: true },
  { level: 'profileTime', useLaneKey: false, useLaneArch: false, useProfile: true, useState: false, useTime: true },
  { level: 'timeOnly', useLaneKey: false, useLaneArch: false, useProfile: false, useState: false, useTime: true },
  { level: 'championSlot', useLaneKey: false, useLaneArch: false, useProfile: false, useState: false, useTime: false },
];
