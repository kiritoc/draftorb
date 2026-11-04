/**
 * @draftorb/etl — Rune-context helpers for rune aggregation.
 *
 * Lane-context slot selection, damage mix, canonical perk hashing and the
 * champion-tags loader. Split out of aggregate-runes.ts (file size); pure
 * move, no logic change.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { championTagsMapSchema, type ChampionTagsMap, type Role } from '@draftorb/shared';
import { DEFAULT_LANE_GROUPS, getInfluence, type RankWeightingConfig } from '@draftorb/engine';

// Back-off context levels (most specific = lowest number, SPECS §8.1).
// Lane contexts increment as slots are dropped (3-slot → 2-slot → 1-slot).
const ROLE_ORDER: readonly string[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

export interface MatchParticipant {
  championId: number;
  role: string;
  win: number;
  puuid: string;
  teamId: number;
  championGames: number;
  masteryPoints: number | null;
  perksJson: string;
}

export interface LaneSlot {
  championId: number;
  side: 'a' | 'e';
  role: string;
}

/**
 * Canonical damage mix of a team's champions. Untagged champions carry no
 * signal and are ignored; with no tagged champion at all the mix is `mixed`.
 */
export function damageMix(championIds: number[], tags: Map<number, string>): 'AD' | 'AP' | 'mixed' {
  let hasAd = false;
  let hasAp = false;
  for (const id of championIds) {
    const dmg = tags.get(id);
    if (dmg === 'AD') hasAd = true;
    else if (dmg === 'AP') hasAp = true;
    else if (dmg === 'MIXED') {
      // Explicit hybrid / true-damage tags count for both sides.
      hasAd = true;
      hasAp = true;
    }
    // 'NONE' contributes no damage signal and is ignored.
  }
  if (hasAd && !hasAp) return 'AD';
  if (hasAp && !hasAd) return 'AP';
  return 'mixed';
}

interface RiotPerksLike {
  statPerks?: { defense?: number; flex?: number; offense?: number };
  styles?: Array<{
    description?: string;
    style?: number;
    selections?: Array<{ perk?: number }>;
  }>;
}

/**
 * Canonical rune page: keeps only selected style / perk / shard ids and drops
 * match-specific `var1..var3` statistics, so identical pages share one hash.
 * Non Riot-shaped JSON is returned unchanged.
 */
export function canonicalPerksJson(perksJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(perksJson);
  } catch {
    return perksJson;
  }
  if (typeof parsed !== 'object' || parsed === null) return perksJson;
  const perks = parsed as RiotPerksLike;
  if (!Array.isArray(perks.styles)) return perksJson;
  const stat = perks.statPerks ?? {};
  return JSON.stringify({
    statPerks: {
      defense: stat.defense ?? null,
      flex: stat.flex ?? null,
      offense: stat.offense ?? null,
    },
    styles: perks.styles.map((s) => ({
      description: s.description ?? null,
      style: s.style ?? null,
      selections: (s.selections ?? []).map((sel) => ({ perk: sel.perk ?? null })),
    })),
  });
}

export function formatSlot(slot: LaneSlot): string {
  return `${slot.side}.${slot.role}:${slot.championId}`;
}

export function loadChampionTags(tagsPath: string): Map<number, string> {
  // A missing or invalid tags file must fail loudly (B-047): silently using an
  // empty map would degrade every damage mix to `mixed`.
  let raw: ChampionTagsMap;
  try {
    raw = championTagsMapSchema.parse(JSON.parse(readFileSync(tagsPath, 'utf8')));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load champion tags from ${tagsPath}: ${reason}`);
  }
  const tags = new Map<number, string>();
  for (const [key, tag] of Object.entries(raw)) {
    const id = Number(key);
    if (Number.isFinite(id) && tag?.damageType) {
      tags.set(id, tag.damageType);
    }
  }
  return tags;
}

export function perksHash(perksJson: string): string {
  return createHash('sha256').update(perksJson).digest('hex');
}

/** Top `contextSlots` lane-context champions for `myRole`, by lane influence. */
export function contextSlots(
  me: MatchParticipant,
  allies: MatchParticipant[],
  enemies: MatchParticipant[],
  config: RankWeightingConfig,
): LaneSlot[] {
  const laneGroup = DEFAULT_LANE_GROUPS[me.role as Role];
  if (laneGroup === undefined) return [];
  const candidates: Array<{
    championId: number;
    role: string;
    influence: number;
    side: number;
    roleOrder: number;
  }> = [];

  for (const role of laneGroup.allies) {
    const ally = allies.find((p) => p.role === role);
    if (!ally) continue;
    candidates.push({
      championId: ally.championId,
      role,
      influence: getInfluence(me.role as Role, 'ally', role, 'lane', config),
      side: 0,
      roleOrder: ROLE_ORDER.indexOf(role),
    });
  }
  for (const role of laneGroup.enemies) {
    const enemy = enemies.find((p) => p.role === role);
    if (!enemy) continue;
    candidates.push({
      championId: enemy.championId,
      role,
      influence: getInfluence(me.role as Role, 'enemy', role, 'lane', config),
      side: 1,
      roleOrder: ROLE_ORDER.indexOf(role),
    });
  }

  candidates.sort((a, b) => {
    if (b.influence !== a.influence) return b.influence - a.influence;
    if (a.side !== b.side) return a.side - b.side; // ally (0) before enemy (1)
    return a.roleOrder - b.roleOrder;
  });

  // Keep influence order (most influential first) and side/role in the key so
  // swapped ally/enemy matchups never share a row.
  return candidates.slice(0, config.contextSlots).map((c) => ({
    championId: c.championId,
    side: c.side === 0 ? 'a' : 'e',
    role: c.role,
  }));
}
