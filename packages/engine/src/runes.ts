/**
 * @draftorb/engine — Rune page recommender (SPECS §8.1, T-040).
 *
 * Pure, deterministic. Takes the per-champion rune export
 * (`roles/<ROLE>/runes/<championId>.json`, T-019), the draft input, role
 * probabilities and champion tags, and returns the top rune pages for the
 * current context with shrunk win rates and sample sizes.
 *
 * Context chain (D-021 back-off, most specific first): the lane-context
 * slots — top `contextSlots` lane-group champions ordered by lane-phase
 * influence, dropping the least influential one at each step — then the
 * enemy damage mix, then the champion-global context. Each page's win rate
 * is shrunk toward the same page's estimate in the next broader context
 * (recursive, terminating at 0.5), mirroring the D-021 layered model.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import { RUNE_RESULT_SCHEMA_VERSION } from '@draftorb/shared';
import type {
  ChampionId,
  DraftInput,
  Role,
  RuneContextEntry,
  RuneExport,
  RunePagePick,
  RuneRecommendationResult,
  RuneRecommendData,
} from '@draftorb/shared';
import { DEFAULT_CONFIG, DEFAULT_RUNE_CONFIG, rankToBucket } from './config.js';
import type { RankWeightingConfig, RuneConfig } from './config.js';
import { isLowData } from './levels.js';
import { shrink } from './weighting.js';
import { aggregateContextPages, computeEnemyDamageMix, contextKeys } from './runes-context.js';
import type { PageAgg, ScoredContext } from './runes-context.js';

// Re-exported for reuse (e.g. item threat profiles, T-053); the rest of
// runes-context stays internal like recommend-indexes/recommend-slots.
export { computeEnemyDamageMix } from './runes-context.js';

/** Prior win rate the broadest (global) context shrinks toward. */
const GLOBAL_PRIOR = 0.5;

/**
 * Recommend rune pages for a champion in the current draft context
 * (SPECS §8.1).
 *
 * @param input      The draft input (same object `recommend` consumes).
 * @param championId The picked champion.
 * @param runeExport The parsed `roles/<ROLE>/runes/<championId>.json` for
 *                   `input.userRole`, or undefined when the export has none.
 * @param data       Role probabilities (slot inference) and champion tags
 *                   (enemy damage mix).
 * @param config     Rank-weighting config (contextSlots, influence, minGames).
 * @param runeConfig Rune-layer config (shrinkage prior, page count, lane
 *                   groups); defaults to DEFAULT_RUNE_CONFIG.
 */
export function recommendRunes(
  input: DraftInput,
  championId: ChampionId,
  runeExport: RuneExport | undefined,
  data: RuneRecommendData,
  config: RankWeightingConfig = DEFAULT_CONFIG,
  runeConfig: RuneConfig = DEFAULT_RUNE_CONFIG,
): RuneRecommendationResult {
  const myRole: Role = input.userRole;
  const mix = computeEnemyDamageMix(
    input.enemies.map((s) => s.championId),
    data.tags,
  );

  const base = {
    schemaVersion: RUNE_RESULT_SCHEMA_VERSION,
    championId,
    myRole,
    damageMix: mix,
  } as const;

  const userBucket = rankToBucket(input.userRank);
  // A mismatched export (wrong champion or role file) is treated as absent
  // rather than silently recommending another champion's pages.
  const usable =
    runeExport !== undefined && runeExport.championId === championId && runeExport.myRole === myRole
      ? runeExport
      : undefined;
  const bucketContexts = (usable?.contexts ?? []).filter((c) => c.rankBucket === userBucket);

  // Match the draft's back-off keys against the export, most specific first.
  const byKey = new Map<string, RuneContextEntry>();
  for (const entry of bucketContexts) {
    if (!byKey.has(entry.contextKey)) byKey.set(entry.contextKey, entry);
  }
  const matched = contextKeys(
    input,
    myRole,
    data.roleProb,
    runeConfig.laneGroups,
    data.tags,
    config,
  )
    .map((key) => byKey.get(key))
    .filter((e): e is RuneContextEntry => e !== undefined)
    .map(aggregateContextPages)
    .filter((c): c is ScoredContext => c !== null)
    .sort((a, b) => a.contextLevel - b.contextLevel || a.contextKey.localeCompare(b.contextKey));

  if (matched.length === 0) {
    return { ...base, pages: [], adaptationHints: [], dataAvailable: false };
  }

  const k = runeConfig.kRune;
  const m = matched.length;

  // Pooled estimate per context, broadest first: each context's total is
  // shrunk toward the pooled estimate of the next broader context (0.5 at
  // the broadest level), mirroring the page-level chain.
  const ctxEst: number[] = new Array<number>(m).fill(GLOBAL_PRIOR);
  for (let j = m - 1; j >= 0; j--) {
    const ctx = matched[j];
    if (ctx === undefined) continue;
    const prior = j === m - 1 ? GLOBAL_PRIOR : ctxEst[j + 1];
    ctxEst[j] = shrink(ctx.totalWinsE, ctx.totalGamesE, k, prior ?? GLOBAL_PRIOR);
  }

  // Page estimate at context j, shrunk toward the same page's estimate at
  // the nearest broader context where it has data; when the page is absent
  // from every broader context, toward that context's pooled estimate.
  const memo = new Map<string, number>();
  const estPage = (key: string, j: number): number => {
    const memoKey = `${String(j)} ${key}`;
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    const ctx = matched[j];
    const agg = ctx?.pages.get(key);
    if (ctx === undefined || agg === undefined) return GLOBAL_PRIOR;
    let prior = GLOBAL_PRIOR;
    let found = false;
    for (let kIdx = j + 1; kIdx < m; kIdx++) {
      if (matched[kIdx]?.pages.has(key)) {
        prior = estPage(key, kIdx);
        found = true;
        break;
      }
    }
    if (!found) {
      prior = j + 1 < m ? (ctxEst[j + 1] ?? GLOBAL_PRIOR) : GLOBAL_PRIOR;
    }
    const value = shrink(agg.winsE, agg.gamesE, k, prior);
    memo.set(memoKey, value);
    return value;
  };

  // Score every page once, at the most specific context where it appears
  // (contexts are ordered specific -> broad, so first sighting wins).
  const scored = new Map<string, { ctx: ScoredContext; agg: PageAgg; score: number }>();
  for (let j = 0; j < m; j++) {
    const ctx = matched[j];
    if (ctx === undefined) continue;
    for (const [key, agg] of ctx.pages) {
      if (scored.has(key)) continue;
      scored.set(key, { ctx, agg, score: estPage(key, j) });
    }
  }

  const ranked = [...scored.entries()]
    .map(([key, s]) => ({ key, ...s }))
    .sort(
      (a, b) =>
        b.score - a.score || b.agg.pickShare - a.agg.pickShare || a.key.localeCompare(b.key),
    )
    .slice(0, Math.max(0, runeConfig.topPages));

  const pages: RunePagePick[] = ranked.map(({ ctx, agg, score }) => ({
    primaryStyleId: agg.primaryStyleId,
    subStyleId: agg.subStyleId,
    keystoneId: agg.keystoneId,
    selectedPerkIds: agg.selectedPerkIds,
    ...(agg.statShardIds !== undefined ? { statShardIds: agg.statShardIds } : {}),
    winRate: score,
    nEff: agg.gamesE,
    ...(agg.players !== undefined ? { players: agg.players } : {}),
    pickShare: agg.pickShare,
    lowData: isLowData(agg.gamesE, config.minGames),
    contextKey: ctx.contextKey,
    contextLevel: ctx.contextLevel,
  }));

  // Adaptation hint (SPECS §8.1): the stat shards most-picked inside the
  // damage-mix context matching the enemy team.
  const adaptationHints: RuneRecommendationResult['adaptationHints'] = [];
  const mixCtx = matched.find((c) => c.contextKey === `damagemix:${mix}`);
  if (mixCtx !== undefined) {
    let best: { key: string; agg: PageAgg } | null = null;
    for (const [key, agg] of mixCtx.pages) {
      if (
        best === null ||
        agg.gamesW > best.agg.gamesW ||
        (agg.gamesW === best.agg.gamesW && key.localeCompare(best.key) < 0)
      ) {
        best = { key, agg };
      }
    }
    const shards = best?.agg.statShardIds;
    if (best !== null && shards !== undefined && shards.length > 0) {
      adaptationHints.push({
        code: 'statShardsVsDamageMix',
        damageMix: mix,
        statShardIds: [...shards],
      });
    }
  }

  return { ...base, pages, adaptationHints, dataAvailable: true };
}
