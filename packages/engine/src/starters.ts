/**
 * @draftorb/engine — Starter-bundle recommender (BL-031b, SPECS §8.3/§18.5).
 *
 * Pure, deterministic. Takes the per-champion starter export
 * (`roles/<ROLE>/starters/<championId>.json`) plus the role/global fallback
 * file (`roles/<ROLE>/starters.json`), the draft input and role
 * probabilities, and returns the top starter bundles for the current
 * context with shrunk win rates and sample sizes.
 *
 * The back-off chain is the D-134/D-086 bundle half (SPECS §18.5): exact
 * lane matchup (`lane:<slots>`, level 1) -> champion (level 2) -> role
 * (level 3) -> global (level 4). The lane key reproduces the ETL
 * `starter_ctx` format (`a.ROLE:id|e.ROLE:id` joined by `|` over the
 * influence-sorted context slots); the champion-level and broader rows come
 * from the two export files. Each bundle's win rate is shrunk toward the
 * same bundle's estimate in the next broader context, mirroring
 * `recommendSummoners`/`recommendRunes` (D-021 back-off). A bundle is the
 * net `starterBundleKey` "itemId:count" set within `starterWindowSeconds`
 * (D-086 bundle half accepted via D-134).
 *
 * Evidence rules (D-102/D-103): every pick carries `nEff`, `players`,
 * `pickShare` and `lowData`; the optional Master+ toggle
 * (`evidenceMasterPlusOnly`) restricts evidence to MASTER_PLUS.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import { STARTER_RESULT_SCHEMA_VERSION } from '@draftorb/shared';
import type {
  ChampionId,
  DraftInput,
  Role,
  StarterBundleItem,
  StarterChampionExport,
  StarterContextEntry,
  StarterPick,
  StarterRecommendationResult,
  StarterRecommendData,
  StarterRoleExport,
} from '@draftorb/shared';
import { DEFAULT_CONFIG, DEFAULT_STARTER_CONFIG, rankToBucket } from './config.js';
import type { RankWeightingConfig, StarterConfig } from './config.js';
import { isLowData } from './levels.js';
import { shrink, toEquivalentCounts } from './weighting.js';
import { selectLaneContextSlots } from './runes-context.js';

/** Prior win rate the broadest (global) context shrinks toward. */
const GLOBAL_PRIOR = 0.5;

interface BundleAgg {
  readonly items: readonly StarterBundleItem[];
  gamesW: number;
  winsE: number;
  gamesE: number;
  players?: number;
  pickShare: number;
}

interface ScoredContext {
  readonly contextKey: string;
  readonly contextLevel: number;
  readonly bundles: Map<string, BundleAgg>;
  readonly totalWinsE: number;
  readonly totalGamesE: number;
}

/**
 * Stable identity of a bundle: its items sorted by itemId in the
 * `starterBundleKey` "itemId:count,..." form. The export already writes
 * sorted items; sorting again keeps hand-built fixtures honest.
 */
function bundleKey(items: readonly StarterBundleItem[]): string {
  return [...items]
    .sort((a, b) => a.itemId - b.itemId)
    .map((item) => `${item.itemId}:${item.count}`)
    .join(',');
}

/**
 * The exact-lane context key for this draft, in the `starter_ctx` format
 * (`lane:a.ROLE:id|e.ROLE:id`, all influence-sorted context slots joined by
 * `|`). Returns null when no lane-group slot resolves — the chain then
 * starts at the champion level.
 */
function starterLaneKey(
  input: DraftInput,
  myRole: Role,
  roleProb: StarterRecommendData['roleProb'],
  laneGroups: StarterConfig['laneGroups'],
  config: RankWeightingConfig,
): string | null {
  const slots = selectLaneContextSlots(input, myRole, roleProb, laneGroups, config);
  if (slots.length === 0) return null;
  return `lane:${slots.map((s) => `${s.side}.${s.role}:${s.championId}`).join('|')}`;
}

/** Ordered back-off context keys for this draft (most specific first). */
function starterContextKeys(
  input: DraftInput,
  myRole: Role,
  roleProb: StarterRecommendData['roleProb'],
  laneGroups: StarterConfig['laneGroups'],
  config: RankWeightingConfig,
): string[] {
  const lane = starterLaneKey(input, myRole, roleProb, laneGroups, config);
  return [...(lane !== null ? [lane] : []), 'champion', 'role', 'global'];
}

/** Merge one exported context's rows into per-bundle equivalent counts. */
function aggregateContextBundles(entry: StarterContextEntry): ScoredContext | null {
  const accums = new Map<
    string,
    {
      items: readonly StarterBundleItem[];
      winsW: number;
      gamesW: number;
      gamesW2: number;
      players?: number;
      pickShare: number;
    }
  >();
  for (const row of entry.bundles) {
    const key = bundleKey(row.items);
    const existing = accums.get(key);
    if (existing === undefined) {
      accums.set(key, {
        items: row.items,
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

  const bundles = new Map<string, BundleAgg>();
  let totalWinsE = 0;
  let totalGamesE = 0;
  for (const [key, acc] of accums) {
    const eq = toEquivalentCounts(acc.winsW, acc.gamesW, acc.gamesW2);
    bundles.set(key, {
      items: acc.items,
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
    bundles,
    totalWinsE,
    totalGamesE,
  };
}

/**
 * Recommend starter-item bundles for a champion in the current draft
 * context (SPECS §8.3/§18.5, BL-031b).
 *
 * @param input           The draft input (same object `recommend` consumes).
 * @param championId      The picked champion.
 * @param championExport  The parsed `roles/<ROLE>/starters/<championId>.json`
 *                        for `input.userRole` (lane + champion levels), or
 *                        undefined when absent.
 * @param roleExport      The parsed `roles/<ROLE>/starters.json` role/global
 *                        fallback file, or undefined when absent.
 * @param data            Role probabilities (lane-slot inference).
 * @param config          Rank-weighting config (contextSlots, influence, minGames).
 * @param starterConfig   Starter-layer config (shrinkage prior, bundle count,
 *                        lane groups); defaults to DEFAULT_STARTER_CONFIG.
 */
export function recommendStarters(
  input: DraftInput,
  championId: ChampionId,
  championExport: StarterChampionExport | undefined,
  roleExport: StarterRoleExport | undefined,
  data: StarterRecommendData,
  config: RankWeightingConfig = DEFAULT_CONFIG,
  starterConfig: StarterConfig = DEFAULT_STARTER_CONFIG,
): StarterRecommendationResult {
  const myRole: Role = input.userRole;

  const base = {
    schemaVersion: STARTER_RESULT_SCHEMA_VERSION,
    championId,
    myRole,
  } as const;

  const userBucket = config.evidenceMasterPlusOnly ? 'MASTER_PLUS' : rankToBucket(input.userRank);
  // A mismatched export (wrong champion or role file) is treated as absent
  // rather than silently recommending another champion's bundles.
  const usableChampion =
    championExport !== undefined &&
    championExport.championId === championId &&
    championExport.myRole === myRole
      ? championExport
      : undefined;
  const usableRole =
    roleExport !== undefined && roleExport.myRole === myRole ? roleExport : undefined;
  const bucketContexts = [
    ...(usableChampion?.contexts ?? []),
    ...(usableRole?.contexts ?? []),
  ].filter((c) => c.rankBucket === userBucket);

  // Match the draft's back-off keys against the exports, most specific first.
  const byKey = new Map<string, StarterContextEntry>();
  for (const entry of bucketContexts) {
    if (!byKey.has(entry.contextKey)) byKey.set(entry.contextKey, entry);
  }
  const matched = starterContextKeys(input, myRole, data.roleProb, starterConfig.laneGroups, config)
    .map((key) => byKey.get(key))
    .filter((e): e is StarterContextEntry => e !== undefined)
    .map(aggregateContextBundles)
    .filter((c): c is ScoredContext => c !== null)
    .sort((a, b) => a.contextLevel - b.contextLevel || a.contextKey.localeCompare(b.contextKey));

  if (matched.length === 0) {
    return { ...base, bundles: [], dataAvailable: false };
  }

  const k = starterConfig.kStarter;
  const m = matched.length;

  // Pooled estimate per context, broadest first (same chain as runes/summoners).
  const ctxEst: number[] = new Array<number>(m).fill(GLOBAL_PRIOR);
  for (let j = m - 1; j >= 0; j--) {
    const ctx = matched[j];
    if (ctx === undefined) continue;
    const prior = j === m - 1 ? GLOBAL_PRIOR : ctxEst[j + 1];
    ctxEst[j] = shrink(ctx.totalWinsE, ctx.totalGamesE, k, prior ?? GLOBAL_PRIOR);
  }

  // Bundle estimate at context j, shrunk toward the same bundle's estimate at
  // the nearest broader context where it has data; when the bundle is absent
  // from every broader context, toward that context's pooled estimate.
  const memo = new Map<string, number>();
  const estBundle = (key: string, j: number): number => {
    const memoKey = `${String(j)} ${key}`;
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    const ctx = matched[j];
    const agg = ctx?.bundles.get(key);
    if (ctx === undefined || agg === undefined) return GLOBAL_PRIOR;
    let prior = GLOBAL_PRIOR;
    let found = false;
    for (let kIdx = j + 1; kIdx < m; kIdx++) {
      if (matched[kIdx]?.bundles.has(key)) {
        prior = estBundle(key, kIdx);
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

  // Score every bundle once, at the most specific context where it appears.
  const scored = new Map<string, { ctx: ScoredContext; agg: BundleAgg; score: number }>();
  for (let j = 0; j < m; j++) {
    const ctx = matched[j];
    if (ctx === undefined) continue;
    for (const [key, agg] of ctx.bundles) {
      if (scored.has(key)) continue;
      scored.set(key, { ctx, agg, score: estBundle(key, j) });
    }
  }

  const ranked = [...scored.entries()]
    .map(([key, s]) => ({ key, ...s }))
    .sort(
      (a, b) =>
        b.score - a.score || b.agg.pickShare - a.agg.pickShare || a.key.localeCompare(b.key),
    )
    .slice(0, Math.max(0, starterConfig.topBundles));

  const bundles: StarterPick[] = ranked.map(({ ctx, agg, score }) => ({
    items: [...agg.items],
    winRate: score,
    nEff: agg.gamesE,
    ...(agg.players !== undefined ? { players: agg.players } : {}),
    pickShare: agg.pickShare,
    lowData: isLowData(agg.gamesE, config.minGames),
    contextKey: ctx.contextKey,
    contextLevel: ctx.contextLevel,
  }));

  return { ...base, bundles, dataAvailable: true };
}
