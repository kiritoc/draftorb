/**
 * @draftorb/engine — Analytic item fight-power model (SPECS §8.2 step 6,
 * T-125).
 *
 * v1 rule score used when the like-for-like data layer has no context with
 * `n_eff >= minGames`. Maps Data Dragon item stat keys to combat-power
 * components, then weights them by the enemy threat profile (AD/AP mix),
 * the fed-enemy threat and the ahead/even/behind state bucket. All weights
 * are priors in `ItemsConfig`; deterministic, no data lookups.
 */

import type { Item, ItemTagsMap } from '@draftorb/shared';

import type { ItemContext } from './context.js';
import type { ItemsConfig } from './config.js';

/** Stat keys read from `Item.stats` (Data Dragon `items.json`). */
const STAT_KEYS = {
  ad: 'FlatPhysicalDamageMod',
  ap: 'FlatMagicDamageMod',
  armor: 'FlatArmorMod',
  mr: 'FlatSpellBlockMod',
  hp: 'FlatHPPoolMod',
  mana: 'FlatMPPoolMod',
  attackSpeed: 'PercentAttackSpeedMod',
  moveSpeed: 'FlatMovementSpeedMod',
  crit: 'FlatCritChanceMod',
  lifesteal: 'PercentLifeStealMod',
  hpRegen: 'FlatHPRegenMod',
} as const;

function stat(item: Item, key: string): number {
  return item.stats[key] ?? 0;
}

/**
 * Raw combat-power components of an item. Percent stats are scaled so they
 * are commensurable with flat stats (1% AS/crit/lifesteal ≈ 1 stat point is
 * the v1 prior; calibration is a D-023 task).
 */
export interface ItemPowerComponents {
  readonly ad: number;
  readonly ap: number;
  readonly armor: number;
  readonly mr: number;
  readonly hp: number;
  readonly mana: number;
  readonly attackSpeed: number;
  readonly moveSpeed: number;
  readonly crit: number;
  readonly lifesteal: number;
  readonly sustain: number;
}

export function itemPowerComponents(item: Item): ItemPowerComponents {
  const lifesteal = stat(item, STAT_KEYS.lifesteal);
  return {
    ad: stat(item, STAT_KEYS.ad),
    ap: stat(item, STAT_KEYS.ap),
    armor: stat(item, STAT_KEYS.armor),
    mr: stat(item, STAT_KEYS.mr),
    hp: stat(item, STAT_KEYS.hp),
    mana: stat(item, STAT_KEYS.mana),
    attackSpeed: stat(item, STAT_KEYS.attackSpeed) * 100,
    moveSpeed: stat(item, STAT_KEYS.moveSpeed),
    crit: stat(item, STAT_KEYS.crit) * 100,
    lifesteal: lifesteal * 100,
    sustain: stat(item, STAT_KEYS.hpRegen) + lifesteal * 50,
  };
}

/**
 * Contextual fight power of `item` for the current `ItemContext`.
 *
 *   power = offenseFit + defenseFit + tagBonus
 *
 * Offense scales AD/AS/crit/lifesteal and AP by the enemy damage profile
 * (each school is devalued when enemies are heavy in its counter-stat) and
 * amplified by `aheadDamageMult` when ahead. Defense scales armor/MR/HP/
 * sustain by the fed-enemy threat and `behindDefenseMult` when behind.
 */
export function analyticItemPower(
  item: Item,
  ctx: ItemContext,
  itemTags: ItemTagsMap | undefined,
  config: ItemsConfig,
): number {
  const c = itemPowerComponents(item);
  const tags = itemTags?.[String(item.id)];

  const adThreat = ctx.profileKey === 'AD' ? 1 : ctx.profileKey === 'mixed' ? 0.5 : 0;
  const apThreat = ctx.profileKey === 'AP' ? 1 : ctx.profileKey === 'mixed' ? 0.5 : 0;
  const fedThreat = ctx.fedEnemyIdx.length > 0 ? 1 : 0;

  const adValue = c.ad + c.attackSpeed * 0.8 + c.crit * 0.5 + c.lifesteal * 0.3;
  const apValue = c.ap + c.mana * 0.05;
  const physicalMitigation = adThreat * 0.35;
  const magicMitigation = apThreat * 0.35;
  const offense =
    (adValue * (1 - physicalMitigation) + apValue * (1 - magicMitigation)) *
    (ctx.stateBucket === 'ahead' ? config.aheadDamageMult : 1);

  const defensePool =
    c.armor * (0.4 + adThreat) +
    c.mr * (0.4 + apThreat) +
    c.hp * 0.15 +
    c.sustain * 0.2 +
    c.moveSpeed * 0.1;
  const defense =
    defensePool *
    (1 + config.fedDefenseWeight * fedThreat) *
    (ctx.stateBucket === 'behind' ? config.behindDefenseMult : 1);

  const tagBonus =
    (tags?.antiHeal ? 15 : 0) +
    (tags?.antiShield ? 10 : 0) +
    (tags?.support ? 8 : 0) +
    (tags?.mana ? c.mana * 0.02 : 0);

  return offense + defense + tagBonus;
}
