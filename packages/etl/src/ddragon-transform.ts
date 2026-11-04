/**
 * Pure Data Dragon transforms (no I/O): version parsing, tag->role mapping and
 * raw-payload -> validated map conversions. Split out of ddragon.ts (file
 * size); pure move, no logic change.
 */

import {
  type ChampionsMap,
  championsMapSchema,
  type ChampionRoleProbabilities,
  type ItemsMap,
  itemsMapSchema,
  type Role,
  type RuneTrees,
  runeTreesSchema,
} from '@draftorb/shared';

import { deriveChampionRoles } from './derive-roles';
import type { RawDDragonChampion, RawDDragonItem, RawDDragonRuneTree } from './ddragon';

/**
 * Extracts the 2-component patch identifier from a full game or Data Dragon version.
 * E.g., '14.23.1' -> '14.23', '16.21.1' -> '16.21'.
 */
export function getPatchFromVersion(version: string): string {
  const parts = version.trim().split('.');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid version format: "${version}". Expected at least two dot-separated segments.`,
    );
  }
  return `${parts[0]}.${parts[1]}`;
}

/**
 * Maps Data Dragon static class tags to draft roles.
 */
export function mapChampionTagsToRoles(tags: readonly string[] | undefined): Role[] {
  const roles = new Set<Role>();
  for (const tag of tags ?? []) {
    switch (tag) {
      case 'Support':
        roles.add('SUPPORT');
        break;
      case 'Marksman':
        roles.add('ADC');
        break;
      case 'Mage':
      case 'Assassin':
        roles.add('MID');
        break;
      case 'Fighter':
      case 'Tank':
        roles.add('TOP');
        break;
    }
  }
  if (roles.size === 0) {
    roles.add('MID');
  }
  return Array.from(roles);
}

/**
 * Transforms raw champion dictionary from Data Dragon into a validated ChampionsMap.
 *
 * When `roleProbabilities` is provided (observed `role_prob` data), each
 * champion's roles are derived from the observed probabilities, replacing the
 * Data Dragon champion-tag bootstrap hint. Champions without role-prob data
 * keep their tag-derived roles.
 */
export function transformChampions(
  rawData: Record<string, RawDDragonChampion>,
  roleProbabilities?: ChampionRoleProbabilities,
): ChampionsMap {
  const champions: Record<string, unknown> = {};
  const derivedRoles =
    roleProbabilities === undefined ? undefined : deriveChampionRoles(roleProbabilities);

  for (const rawChamp of Object.values(rawData)) {
    const id = parseInt(rawChamp.key, 10);
    if (isNaN(id) || id <= 0) {
      continue;
    }
    const roles = derivedRoles?.[String(id)] ?? mapChampionTagsToRoles(rawChamp.tags);
    const champion = {
      id,
      name: rawChamp.name,
      icon: rawChamp.image?.full ?? `${rawChamp.id}.png`,
      roles,
    };
    champions[String(id)] = champion;
  }

  return championsMapSchema.parse(champions);
}

/**
 * Transforms raw item dictionary from Data Dragon into a validated ItemsMap.
 */
export function transformItems(rawData: Record<string, RawDDragonItem>): ItemsMap {
  const items: Record<string, unknown> = {};

  for (const [idStr, rawItem] of Object.entries(rawData)) {
    const id = parseInt(idStr, 10);
    if (isNaN(id) || id <= 0) {
      continue;
    }
    if (!rawItem.name || !rawItem.name.trim()) {
      // Data Dragon contains empty-name internal placeholder items; skip them
      continue;
    }

    const item = {
      id,
      name: rawItem.name.trim(),
      icon: rawItem.image?.full ?? '',
      goldTotal: rawItem.gold?.total ?? 0,
      purchasable: Boolean(rawItem.gold?.purchasable),
      tags: rawItem.tags ?? [],
      from: (rawItem.from ?? []).map((x) => parseInt(x, 10)).filter((n) => !isNaN(n) && n > 0),
      into: (rawItem.into ?? []).map((x) => parseInt(x, 10)).filter((n) => !isNaN(n) && n > 0),
      stats: rawItem.stats ?? {},
    };

    items[String(id)] = item;
  }

  return itemsMapSchema.parse(items);
}

/**
 * Transforms raw runesReforged array from Data Dragon into validated RuneTrees.
 */
export function transformRunes(rawTrees: RawDDragonRuneTree[]): RuneTrees {
  const trees = rawTrees.map((tree) => ({
    id: tree.id,
    key: tree.key,
    icon: tree.icon,
    name: tree.name,
    slots: (tree.slots ?? []).map((slot) => ({
      runes: (slot.runes ?? []).map((rune) => ({
        id: rune.id,
        key: rune.key,
        name: rune.name,
        icon: rune.icon,
        shortDesc: rune.shortDesc,
      })),
    })),
  }));

  return runeTreesSchema.parse(trees);
}
