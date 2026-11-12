/**
 * @draftorb/etl — Item classification pipeline (T-051 Phase B, D-082).
 *
 * `classifyItem` assigns every Data Dragon item a class used by aggregation:
 *
 *   'starter'        — laning starting items (Doran's, support starters)
 *   'quest_line'     — quest-line items that are never completed items
 *                      (World Atlas, Bounty of Worlds)
 *   'quest_reward'   — quest completion rewards (support item line)
 *   'jungle_path'    — jungle pet + pet-upgrade path markers (pet selection
 *                      info, never a completed item)
 *   'component'      — build components / lane-line intermediates
 *   'boots'          — completed boots (advance the completed-item index)
 *   'completed'      — completed legendary/epic items
 *   'consumable'     — potions, wards, elixirs, control items
 *   'excluded'       — non-gameplay/internal items (mode items, tokens)
 *
 * Classification order matters: mode/internal filters run first, then the
 * quest/pet path classes, then boots/completed, then consumables, and
 * finally components. Manual overrides in data/manual/item-classes.json
 * win over generated classes.
 *
 * No file I/O in `classifyItem`; `loadItemClasses` reads the generated file
 * plus overrides.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RawDDragonItem } from './ddragon';
import { defaultManualDataDir, resolveRepoRoot } from './config/paths';

export type ItemClass =
  | 'starter'
  | 'quest_line'
  | 'quest_reward'
  | 'jungle_path'
  | 'component'
  | 'boots'
  | 'completed'
  | 'consumable'
  | 'excluded';

export interface ItemClassEntry {
  readonly cls: ItemClass;
  /** Lane family for quest_line/quest_reward (e.g. 'support', 'jungle'). */
  readonly laneFamily?: string;
}

export type ItemClassMap = ReadonlyMap<number, ItemClassEntry>;

const JUNGLE_PET_IDS = new Set([1101, 1102, 1103, 1104, 1105, 1106, 1107]);

/** Support quest-line/reward id ranges observed in Data Dragon 16.x. */
const SUPPORT_QUEST_LINE_IDS = new Set([3865, 3866, 3867, 3868]);
const SUPPORT_QUEST_REWARD_IDS = new Set([3869, 3870, 3871, 3876, 3877]);

/** Classic jungle pet quest / upgrade internals. */
const JUNGLE_QUEST_IDS = new Set([
  1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211, 1212, 1213, 1214, 1215, 1216,
]);

function isSummonersRift(item: RawDDragonItem): boolean {
  const maps = item.maps;
  if (maps === undefined) return true; // older catalogs: assume SR
  return maps['11'] === true || Object.values(maps).some((v) => v === true);
}

function isPurchasable(item: RawDDragonItem): boolean {
  // gold.purchasable is authoritative; inStore=false means shop-internal.
  if (item.inStore === false) return false;
  return item.gold?.purchasable === true;
}

/**
 * Pure classification. `item` is the raw Data Dragon record; `id` its
 * numeric key. Returns the class plus a lane family when known.
 */
export function classifyItem(id: number, item: RawDDragonItem): ItemClassEntry {
  const tags = new Set(item.tags ?? []);
  const name = item.name.toLowerCase();

  // 1. Internal / mode-only / hidden items never enter gameplay contexts.
  if (!isSummonersRift(item)) return { cls: 'excluded' };
  if (item.hideFromAll === true) return { cls: 'excluded' };
  if (item.requiredChampion !== undefined && item.requiredChampion !== '') {
    return { cls: 'excluded' };
  }
  if (item.specialRecipe !== undefined && item.specialRecipe > 0) {
    // specialRecipe items are granted, not bought through the shop path.
    // Quest rewards use specialRecipe; classify below before excluding.
  }

  // 2. Quest / path classes (never completed items, never advance slot).
  if (SUPPORT_QUEST_LINE_IDS.has(id) || (tags.has('Quest') && tags.has('Support'))) {
    return { cls: 'quest_line', laneFamily: 'support' };
  }
  if (SUPPORT_QUEST_REWARD_IDS.has(id) || (tags.has('Quest') && tags.has('Lane'))) {
    // Distinguish support rewards from generic lane quest items by id/name.
    if (SUPPORT_QUEST_REWARD_IDS.has(id) || name.includes('world atlas') === false) {
      if (SUPPORT_QUEST_REWARD_IDS.has(id)) return { cls: 'quest_reward', laneFamily: 'support' };
    }
  }
  if (JUNGLE_PET_IDS.has(id) || (tags.has('Jungle') && tags.has('Pet'))) {
    return { cls: 'jungle_path', laneFamily: 'jungle' };
  }
  if (
    JUNGLE_QUEST_IDS.has(id) ||
    (tags.has('Jungle') && (item.into ?? []).length === 0 && !isPurchasable(item))
  ) {
    return { cls: 'jungle_path', laneFamily: 'jungle' };
  }

  // 3. Starter items: cheap lane-opening items with no build path.
  const isStarter =
    tags.has('Lane') &&
    (item.into ?? []).length === 0 &&
    !tags.has('Consumable') &&
    !tags.has('Trinket') &&
    isPurchasable(item) &&
    !tags.has('Quest');
  if (isStarter || tags.has('Doran') || name.includes('doran')) {
    return { cls: 'starter' };
  }

  // 4. Consumables / trinkets / wards.
  if (tags.has('Consumable') || tags.has('Trinket') || tags.has('Ward')) {
    return { cls: 'consumable' };
  }

  // 5. Boots are completed items that advance the completed index.
  if (tags.has('Boots') || tags.has('BootsEnchanted')) {
    return { cls: 'boots' };
  }

  // 6. Completed vs component: empty `into` means nothing builds from it.
  if ((item.into ?? []).length === 0) {
    if (!isPurchasable(item)) return { cls: 'excluded' };
    return { cls: 'completed' };
  }
  return { cls: 'component' };
}

/**
 * Generated classes file. Lives under data/ (tracked) rather than
 * data/public/ (gitignored) so the taxonomy is versioned with the repo.
 * Classes are patch-stable enough for aggregation; regenerate per patch.
 */
export function generatedClassesPath(): string {
  return join(resolveRepoRoot(), 'data', 'item-classes.generated.json');
}

/** Manual overrides path. */
export function overridesClassesPath(): string {
  return join(defaultManualDataDir(), 'item-classes.json');
}

/**
 * Loads generated classes plus manual overrides into a lookup map. Missing
 * generated file yields an empty map (callers treat items as unclassified).
 */
export function loadItemClasses(): Map<number, ItemClassEntry> {
  const map = new Map<number, ItemClassEntry>();
  try {
    const raw = JSON.parse(readFileSync(generatedClassesPath(), 'utf8')) as {
      items?: Record<string, ItemClassEntry>;
    };
    for (const [key, entry] of Object.entries(raw.items ?? {})) {
      const id = Number(key);
      if (Number.isFinite(id)) map.set(id, entry);
    }
  } catch {
    // Missing/invalid generated file: classes are optional at load time.
  }
  try {
    const raw = JSON.parse(readFileSync(overridesClassesPath(), 'utf8')) as {
      items?: Record<string, ItemClassEntry>;
    };
    for (const [key, entry] of Object.entries(raw.items ?? {})) {
      const id = Number(key);
      if (Number.isFinite(id)) map.set(id, entry);
    }
  } catch {
    // No overrides file is fine.
  }
  return map;
}

/** Builds the generated classes record for a raw item catalog. */
export function buildItemClasses(
  rawItems: Record<string, RawDDragonItem>,
): Record<string, ItemClassEntry> {
  const out: Record<string, ItemClassEntry> = {};
  for (const [key, item] of Object.entries(rawItems)) {
    const id = Number(key);
    if (!Number.isFinite(id) || id <= 0 || !item.name?.trim()) continue;
    out[String(id)] = classifyItem(id, item);
  }
  return out;
}
