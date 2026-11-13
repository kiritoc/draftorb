/**
 * @draftorb/engine — Item recommender (SPECS §8.2, T-125).
 *
 * `recommendItems` turns a `GameState` into next-item picks:
 *
 *  1. Derive the like-for-like context (slot, time bucket, state bucket,
 *     enemy profile, lane key/arch) — `context.ts`.
 *  2. Data layer (D-022): walk the back-off levels (exact lane → lane arch →
 *     profile+state+time → profile+time → time → champion/slot), merge the
 *     matching `item_build` contexts, shrink each item's win rate toward the
 *     pooled context estimate and score `itemWR - contextAvgWR`. The first
 *     level whose merged n_eff clears `minGames` wins; per-item `lowData`
 *     flags items below the gate inside a usable level.
 *  3. Analytic fallback (step 6): when no level clears `minGames`, rank
 *     candidates by `analyticItemPower` (threat profile × state × fed
 *     enemies × item tags). Disabled via `analyticEnabled`.
 *
 * Observational phrasing only — the data layer reports "players who bought
 * X here won Y %", never causal claims. Pure: no DOM/Node/network/IO.
 */

import type {
  GameState,
  ItemBuildExport,
  ItemClassesExport,
  ItemId,
  ItemsMap,
  ItemTagsMap,
  ChampionTagsMap,
  Role,
  StateScaleExport,
} from '@draftorb/shared';

import {
  DEFAULT_CONFIG,
  DEFAULT_ITEM_CONTEXT_CONFIG,
  DEFAULT_LANE_GROUPS,
  DEFAULT_THREAT_CONFIG,
} from '../config.js';
import type { ItemContextConfig, LaneGroup, RankWeightingConfig, ThreatConfig } from '../config.js';
import { toEquivalentCounts } from '../weighting.js';
import { analyticItemPower } from './analytic.js';
import { deriveItemContext, ITEM_CONTEXT_LEVELS } from './context.js';
import type { ItemContext, ItemLaneContext } from './context.js';
import { DEFAULT_ITEMS_CONFIG } from './config.js';
import type { ItemsConfig } from './config.js';
import type { ItemPick, ItemRecommendationResult } from './types.js';

export interface RecommendItemsInput {
  readonly state: GameState;
  readonly myRole: Role;
  /** `roles/<ROLE>/builds/<championId>.json` export for `state.me.championId`. */
  readonly build?: ItemBuildExport;
  readonly items: ItemsMap;
  readonly itemClasses: ItemClassesExport;
  readonly itemTags?: ItemTagsMap;
  readonly championTags?: ChampionTagsMap;
  readonly stateScale?: StateScaleExport;
  /** Draft lane context for `lane:` keys (roles around `me`). */
  readonly lane?: ItemLaneContext;
  readonly itemsConfig?: ItemsConfig;
  readonly itemConfig?: ItemContextConfig;
  readonly rankConfig?: RankWeightingConfig;
  readonly laneGroups?: Readonly<Record<Role, LaneGroup>>;
  readonly threatConfig?: ThreatConfig;
}

/** Item classes eligible as a pick at `slotIdx`. */
function eligibleClasses(slotIdx: number): ReadonlySet<string> {
  return slotIdx === 0 ? new Set(['starter', 'quest_line']) : new Set(['completed', 'boots']);
}

interface MergedItem {
  itemId: ItemId;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  pickShareSum: number;
}

function mergeContexts(
  contexts: readonly {
    items: readonly {
      itemId: ItemId;
      winsW: number;
      gamesW: number;
      gamesW2: number;
      pickShare: number;
    }[];
  }[],
): Map<ItemId, MergedItem> {
  const merged = new Map<ItemId, MergedItem>();
  for (const ctx of contexts) {
    for (const it of ctx.items) {
      const acc = merged.get(it.itemId) ?? {
        itemId: it.itemId,
        winsW: 0,
        gamesW: 0,
        gamesW2: 0,
        pickShareSum: 0,
      };
      acc.winsW += it.winsW;
      acc.gamesW += it.gamesW;
      acc.gamesW2 += it.gamesW2;
      acc.pickShareSum += it.pickShare;
      merged.set(it.itemId, acc);
    }
  }
  return merged;
}

function levelMatches(
  ctx: ItemContext,
  buildCtx: {
    timeBucket: string;
    stateBucket: string;
    profileKey: string;
    laneKey?: string;
    laneArch?: string;
  },
  spec: (typeof ITEM_CONTEXT_LEVELS)[number],
): boolean {
  if (spec.useTime && buildCtx.timeBucket !== ctx.timeBucket) return false;
  if (spec.useState && buildCtx.stateBucket !== ctx.stateBucket) return false;
  if (spec.useProfile && buildCtx.profileKey !== ctx.profileKey) return false;
  if (spec.useLaneKey) {
    if (ctx.laneKey === '' || buildCtx.laneKey !== ctx.laneKey) return false;
  } else if (spec.useLaneArch) {
    if (ctx.laneArch === '' || (buildCtx.laneArch ?? '') !== ctx.laneArch) return false;
  }
  return true;
}

function pickReasons(
  source: ItemPick['source'],
  ctx: ItemContext,
  itemId: ItemId,
  itemName: string | undefined,
): string[] {
  const reasons: string[] = [];
  if (source === 'data') {
    reasons.push(
      `players who bought ${itemName ?? `item ${itemId}`} in this context won more often`,
    );
  }
  if (ctx.profileKey === 'AD') reasons.push('enemy team is AD-heavy');
  if (ctx.profileKey === 'AP') reasons.push('enemy team is AP-heavy');
  if (ctx.fedEnemyIdx.length > 0) reasons.push('an enemy is fed');
  if (ctx.stateBucket === 'behind') reasons.push('behind -> durability');
  if (ctx.stateBucket === 'ahead') reasons.push('ahead -> tempo');
  return reasons;
}

/**
 * Recommend the next `topItems` items for `state.me`. Returns complete
 * lists; the UI slices. See file header for the scoring pipeline.
 */
export function recommendItems(input: RecommendItemsInput): ItemRecommendationResult {
  const itemsConfig = input.itemsConfig ?? DEFAULT_ITEMS_CONFIG;
  const itemConfig = input.itemConfig ?? DEFAULT_ITEM_CONTEXT_CONFIG;
  const rankConfig = input.rankConfig ?? DEFAULT_CONFIG;
  const threatConfig = input.threatConfig ?? DEFAULT_THREAT_CONFIG;

  const itemClassesMap = new Map<number, { cls: string }>();
  for (const [id, entry] of Object.entries(input.itemClasses.items)) {
    itemClassesMap.set(Number(id), { cls: entry.cls });
  }

  const ctx = deriveItemContext(input.state, input.myRole, {
    itemClasses: itemClassesMap,
    items: input.items,
    championTags: input.championTags,
    lane: input.lane,
    stateScale: input.stateScale,
    itemConfig,
    rankConfig,
    laneGroups: input.laneGroups ?? DEFAULT_LANE_GROUPS,
    threatConfig,
    itemsConfig,
  });

  const owned = new Set(input.state.me.items.map(Number));
  const alreadyOwned = [...owned];
  const eligible = eligibleClasses(ctx.slotIdx);

  // Candidate set: purchasable catalog items of an eligible class, not owned.
  const candidates = new Map<ItemId, { id: ItemId; name?: string }>();
  for (const [idStr, item] of Object.entries(input.items)) {
    const id = Number(idStr);
    if (owned.has(id) || !item.purchasable) continue;
    const cls = itemClassesMap.get(id)?.cls;
    if (cls === undefined || !eligible.has(cls)) continue;
    candidates.set(id, { id, name: item.name });
  }

  const base = {
    slotIdx: ctx.slotIdx,
    alreadyOwned,
  };

  if (candidates.size === 0) {
    return { ...base, picks: [], avoid: [], dataAvailable: false };
  }

  // --- Data layer ---
  const build =
    input.build !== undefined &&
    input.build.championId === input.state.me.championId &&
    input.build.myRole === input.myRole
      ? input.build
      : undefined;

  if (build !== undefined) {
    const slotContexts = build.contexts.filter((c) => c.slotIdx === ctx.slotIdx);
    for (const spec of ITEM_CONTEXT_LEVELS) {
      const matched = slotContexts.filter((c) => levelMatches(ctx, c, spec));
      if (matched.length === 0) continue;
      const merged = mergeContexts(matched);
      // Level gate: total n_eff across merged items must clear minGames.
      let totalGamesE = 0;
      for (const m of merged.values()) {
        totalGamesE += toEquivalentCounts(m.winsW, m.gamesW, m.gamesW2).gamesE;
      }
      if (totalGamesE < itemsConfig.minGames) continue;

      // Pooled context estimate is the shrinkage prior for every item.
      let poolWinsE = 0;
      let poolGamesE = 0;
      const eq = new Map<ItemId, { winsE: number; gamesE: number }>();
      for (const [id, m] of merged) {
        const e = toEquivalentCounts(m.winsW, m.gamesW, m.gamesW2);
        eq.set(id, e);
        poolWinsE += e.winsE;
        poolGamesE += e.gamesE;
      }
      const contextAvg = poolGamesE > 0 ? poolWinsE / poolGamesE : 0.5;

      const scored: ItemPick[] = [];
      for (const cand of candidates.values()) {
        const m = merged.get(cand.id);
        if (m === undefined) continue; // no data for this item in context
        const e = eq.get(cand.id);
        if (e === undefined) continue;
        const est =
          e.gamesE + itemsConfig.kItem > 0
            ? (e.winsE + itemsConfig.kItem * contextAvg) / (e.gamesE + itemsConfig.kItem)
            : contextAvg;
        const nEff = e.gamesE;
        scored.push({
          itemId: cand.id,
          score: est - contextAvg,
          winRate: est,
          nEff,
          lowData: nEff < itemsConfig.minGames,
          pickShare: Math.min(1, m.pickShareSum),
          source: 'data',
          contextLevel: spec.level,
          reasons: pickReasons('data', ctx, cand.id, cand.name),
        });
      }
      if (scored.length === 0) continue;
      scored.sort(
        (a, b) =>
          b.score - a.score || (b.pickShare ?? 0) - (a.pickShare ?? 0) || a.itemId - b.itemId,
      );
      const picks = scored.slice(0, itemsConfig.topItems);
      const pickIds = new Set(picks.map((p) => p.itemId));
      const avoid = scored
        .filter((p) => !pickIds.has(p.itemId))
        .slice(-itemsConfig.avoidItems)
        .reverse();
      return { ...base, picks, avoid, dataAvailable: true };
    }
  }

  // --- Analytic fallback ---
  if (itemsConfig.analyticEnabled) {
    const scored: ItemPick[] = [];
    for (const cand of candidates.values()) {
      const item = input.items[String(cand.id)];
      if (item === undefined) continue;
      scored.push({
        itemId: cand.id,
        score: analyticItemPower(item, ctx, input.itemTags, itemsConfig),
        lowData: true,
        source: 'analytic',
        reasons: pickReasons('analytic', ctx, cand.id, cand.name),
      });
    }
    scored.sort((a, b) => b.score - a.score || a.itemId - b.itemId);
    const picks = scored.slice(0, itemsConfig.topItems);
    const pickIds = new Set(picks.map((p) => p.itemId));
    const avoid = scored
      .filter((p) => !pickIds.has(p.itemId))
      .slice(-itemsConfig.avoidItems)
      .reverse();
    return { ...base, picks, avoid, dataAvailable: picks.length > 0 };
  }

  return { ...base, picks: [], avoid: [], dataAvailable: false };
}
