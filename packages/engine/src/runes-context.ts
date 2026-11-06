/**
 * @draftorb/engine — Context building for the rune recommender (SPECS §8.1).
 *
 * Reproduces the `context_key` values the ETL aggregator writes into
 * `rune_ctx` (aggregate-runes.ts): `lane:` prefixes of the
 * influence-sorted lane-context slots, then `damagemix:<mix>`, then
 * `global`. Pure helpers shared by `runes.ts`.
 */

import type {
  ChampionId,
  ChampionTagsMap,
  DraftInput,
  EnemyDamageMix,
  Role,
  RuneContextEntry,
  RuneRecommendData,
} from '@draftorb/shared';
import { getInfluence } from './config.js';
import type { LaneGroup, RankWeightingConfig } from './config.js';
import { resolveKnownSlots } from './recommend-slots.js';
import { toEquivalentCounts } from './weighting.js';

/** Role order for context-slot ties (SPECS §8.1, same as the ETL aggregator). */
const ROLE_ORDER: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

/**
 * Enemy-team damage mix from champion tags (D-021 `damagemix:` context).
 * Untagged and `NONE` champions carry no signal; `MIXED` counts for both
 * sides; with no tagged champion at all the mix is `mixed`.
 */
export function computeEnemyDamageMix(
  championIds: readonly ChampionId[],
  tags: ChampionTagsMap,
): EnemyDamageMix {
  let hasAd = false;
  let hasAp = false;
  for (const id of championIds) {
    const dmg = tags[String(id)]?.damageType;
    if (dmg === 'AD') hasAd = true;
    else if (dmg === 'AP') hasAp = true;
    else if (dmg === 'MIXED') {
      hasAd = true;
      hasAp = true;
    }
  }
  if (hasAd && !hasAp) return 'AD';
  if (hasAp && !hasAd) return 'AP';
  return 'mixed';
}

interface LaneContextSlot {
  readonly championId: ChampionId;
  /** 'a' for ally, 'e' for enemy — matches the exported `formatSlot` keys. */
  readonly side: 'a' | 'e';
  readonly role: Role;
  readonly influence: number;
  readonly sideOrder: number;
  readonly roleOrder: number;
}

/**
 * Top `contextSlots` lane-context champions for `myRole`, ordered by
 * descending lane-phase influence (ties: ally before enemy, then role
 * order) — the same selection the ETL aggregator applies to real matches
 * (SPECS §8.1, D-020/D-022). Only champions whose role was resolved are
 * eligible; unknown slots simply produce no key.
 */
function selectLaneContextSlots(
  input: DraftInput,
  myRole: Role,
  roleProb: RuneRecommendData['roleProb'],
  laneGroups: Readonly<Record<Role, LaneGroup>>,
  config: RankWeightingConfig,
): LaneContextSlot[] {
  const laneGroup = laneGroups[myRole];
  const allySlots = resolveKnownSlots(input.allies, 'ally', roleProb, [myRole]);
  const enemySlots = resolveKnownSlots(input.enemies, 'enemy', roleProb);

  const candidates: LaneContextSlot[] = [];
  for (const slot of [...allySlots, ...enemySlots]) {
    const inLaneGroup =
      slot.side === 'ally'
        ? laneGroup.allies.includes(slot.role)
        : laneGroup.enemies.includes(slot.role);
    if (!inLaneGroup) continue;
    candidates.push({
      championId: slot.championId,
      side: slot.side === 'ally' ? 'a' : 'e',
      role: slot.role,
      influence: getInfluence(myRole, slot.side, slot.role, 'lane', config),
      sideOrder: slot.side === 'ally' ? 0 : 1,
      roleOrder: ROLE_ORDER.indexOf(slot.role),
    });
  }

  candidates.sort(
    (a, b) =>
      b.influence - a.influence ||
      a.sideOrder - b.sideOrder ||
      a.roleOrder - b.roleOrder ||
      a.championId - b.championId,
  );
  return candidates.slice(0, config.contextSlots);
}

/**
 * Ordered back-off context keys for this draft (most specific first), in the
 * exact `context_key` format the ETL aggregator writes: `lane:` prefixes of
 * the influence-sorted slots, then `damagemix:<mix>`, then `global`.
 * Ordering is re-established from the export's `contextLevel` at match time.
 */
export function contextKeys(
  input: DraftInput,
  myRole: Role,
  roleProb: RuneRecommendData['roleProb'],
  laneGroups: Readonly<Record<Role, LaneGroup>>,
  tags: ChampionTagsMap,
  config: RankWeightingConfig,
): string[] {
  const slots = selectLaneContextSlots(input, myRole, roleProb, laneGroups, config);
  const keys: string[] = [];
  for (let n = slots.length; n >= 1; n--) {
    keys.push(
      `lane:${slots
        .slice(0, n)
        .map((s) => `${s.side}.${s.role}:${s.championId}`)
        .join(',')}`,
    );
  }
  const mix = computeEnemyDamageMix(
    input.enemies.map((s) => s.championId),
    tags,
  );
  keys.push(`damagemix:${mix}`, 'global');
  return keys;
}

/** Identity of a rune page across contexts (all exported page fields). */
export function pageKey(page: {
  primaryStyleId: number;
  subStyleId: number;
  keystoneId: number;
  selectedPerkIds: number[];
  statShardIds?: number[];
}): string {
  return JSON.stringify([
    page.primaryStyleId,
    page.subStyleId,
    page.keystoneId,
    page.selectedPerkIds,
    page.statShardIds ?? [],
  ]);
}

export interface PageAgg {
  readonly primaryStyleId: number;
  readonly subStyleId: number;
  readonly keystoneId: number;
  readonly selectedPerkIds: number[];
  readonly statShardIds?: number[];
  /** Raw weighted game count: pick-share denominator and "most picked" signal. */
  gamesW: number;
  winsE: number;
  gamesE: number;
  players?: number;
  pickShare: number;
}

export interface ScoredContext {
  readonly contextKey: string;
  readonly contextLevel: number;
  readonly pages: Map<string, PageAgg>;
  readonly totalWinsE: number;
  readonly totalGamesE: number;
}

/**
 * Merge one exported context's rows into per-page equivalent counts.
 * Rows describing the same displayed page (same exported fields) are
 * merged; pick shares share one denominator, so they add up.
 *
 * `n_eff = (Σw)² / Σw²` is computed on the merged weights, not as a sum of
 * the rows' individual `n_eff` (B-063): rows with different perk hashes but
 * identical exported fields share one displayed page, and their effective
 * sample size must be recomputed from the combined `gamesW`/`gamesW2`.
 */
export function aggregateContextPages(entry: RuneContextEntry): ScoredContext | null {
  interface Accum {
    primaryStyleId: number;
    subStyleId: number;
    keystoneId: number;
    selectedPerkIds: number[];
    statShardIds?: number[];
    winsW: number;
    gamesW: number;
    gamesW2: number;
    players?: number;
    pickShare: number;
  }
  const accums = new Map<string, Accum>();
  for (const row of entry.pages) {
    const key = pageKey(row);
    const existing = accums.get(key);
    if (existing === undefined) {
      accums.set(key, {
        primaryStyleId: row.primaryStyleId,
        subStyleId: row.subStyleId,
        keystoneId: row.keystoneId,
        selectedPerkIds: row.selectedPerkIds,
        ...(row.statShardIds !== undefined ? { statShardIds: row.statShardIds } : {}),
        winsW: row.winsW,
        gamesW: row.gamesW,
        gamesW2: row.gamesW2,
        ...(row.players !== undefined ? { players: row.players } : {}),
        pickShare: row.pickShare,
      });
    } else {
      existing.winsW += row.winsW;
      existing.gamesW += row.gamesW;
      existing.gamesW2 += row.gamesW2;
      existing.pickShare = Math.min(1, existing.pickShare + row.pickShare);
      if (row.players !== undefined) {
        existing.players = Math.max(existing.players ?? 0, row.players);
      }
    }
  }
  if (accums.size === 0) return null;

  const pages = new Map<string, PageAgg>();
  let totalWinsE = 0;
  let totalGamesE = 0;
  for (const [key, acc] of accums) {
    const eq = toEquivalentCounts(acc.winsW, acc.gamesW, acc.gamesW2);
    pages.set(key, {
      primaryStyleId: acc.primaryStyleId,
      subStyleId: acc.subStyleId,
      keystoneId: acc.keystoneId,
      selectedPerkIds: acc.selectedPerkIds,
      ...(acc.statShardIds !== undefined ? { statShardIds: acc.statShardIds } : {}),
      gamesW: acc.gamesW,
      winsE: eq.winsE,
      gamesE: eq.gamesE,
      ...(acc.players !== undefined ? { players: acc.players } : {}),
      pickShare: acc.pickShare,
    });
    totalWinsE += eq.winsE;
    totalGamesE += eq.gamesE;
  }
  return {
    contextKey: entry.contextKey,
    contextLevel: entry.contextLevel,
    pages,
    totalWinsE,
    totalGamesE,
  };
}
