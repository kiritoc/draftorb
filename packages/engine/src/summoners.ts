/**
 * @draftorb/engine — Summoner-spell-pair recommender (BL-031a, SPECS §8.1).
 *
 * Pure, deterministic. Takes the per-champion summoner export
 * (`roles/<ROLE>/summoners/<championId>.json`), the draft input, role
 * probabilities and champion tags, and returns the top spell pairs for the
 * current context with shrunk win rates and sample sizes.
 *
 * The context chain and shrinkage mirror `recommendRunes` exactly (D-021
 * back-off): lane slots -> damage mix -> global, each pair's win rate
 * shrunk toward the same pair's estimate in the next broader context. Pairs
 * are the unordered normalized `[minId, maxId]` form (SPECS §18.5).
 *
 * Evidence rules (D-102/D-103): every pick carries `nEff`, `players`,
 * `pickShare` and `lowData`; the optional Master+ toggle
 * (`evidenceMasterPlusOnly`) restricts evidence to MASTER_PLUS.
 *
 * No DOM, no Node APIs, no network, no file I/O, no randomness.
 */

import { SUMMONER_RESULT_SCHEMA_VERSION } from '@draftorb/shared';
import type {
  ChampionId,
  DraftInput,
  Role,
  SummonerContextEntry,
  SummonerExport,
  SummonerPairPick,
  SummonerRecommendationResult,
  SummonerRecommendData,
} from '@draftorb/shared';
import { DEFAULT_CONFIG, DEFAULT_SUMMONER_CONFIG, rankToBucket } from './config.js';
import type { RankWeightingConfig, SummonerConfig } from './config.js';
import { isLowData, meetsEvidenceGate } from './levels.js';
import { shrink, toEquivalentCounts } from './weighting.js';
import { computeEnemyDamageMix, contextKeys } from './runes-context.js';

/** Prior win rate the broadest (global) context shrinks toward. */
const GLOBAL_PRIOR = 0.5;

interface PairAgg {
  readonly summoner1Id: number;
  readonly summoner2Id: number;
  gamesW: number;
  winsE: number;
  gamesE: number;
  players?: number;
  pickShare: number;
}

interface ScoredContext {
  readonly contextKey: string;
  readonly contextLevel: number;
  readonly pairs: Map<string, PairAgg>;
  readonly totalWinsE: number;
  readonly totalGamesE: number;
}

/** Merge one exported context's rows into per-pair equivalent counts. */
function aggregateContextPairs(entry: SummonerContextEntry): ScoredContext | null {
  const accums = new Map<
    string,
    {
      summoner1Id: number;
      summoner2Id: number;
      winsW: number;
      gamesW: number;
      gamesW2: number;
      players?: number;
      pickShare: number;
    }
  >();
  for (const row of entry.pairs) {
    const key = `${row.summoner1Id}:${row.summoner2Id}`;
    const existing = accums.get(key);
    if (existing === undefined) {
      accums.set(key, {
        summoner1Id: row.summoner1Id,
        summoner2Id: row.summoner2Id,
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

  const pairs = new Map<string, PairAgg>();
  let totalWinsE = 0;
  let totalGamesE = 0;
  for (const [key, acc] of accums) {
    const eq = toEquivalentCounts(acc.winsW, acc.gamesW, acc.gamesW2);
    pairs.set(key, {
      summoner1Id: acc.summoner1Id,
      summoner2Id: acc.summoner2Id,
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
    pairs,
    totalWinsE,
    totalGamesE,
  };
}

/**
 * Recommend summoner-spell pairs for a champion in the current draft
 * context (SPECS §8.1, BL-031a).
 *
 * @param input           The draft input (same object `recommend` consumes).
 * @param championId      The picked champion.
 * @param summonerExport  The parsed `roles/<ROLE>/summoners/<championId>.json`
 *                        for `input.userRole`, or undefined when absent.
 * @param data            Role probabilities (slot inference) and champion
 *                        tags (enemy damage mix).
 * @param config          Rank-weighting config (contextSlots, influence, minGames).
 * @param summonerConfig  Summoner-layer config (shrinkage prior, pair count,
 *                        lane groups); defaults to DEFAULT_SUMMONER_CONFIG.
 */
export function recommendSummoners(
  input: DraftInput,
  championId: ChampionId,
  summonerExport: SummonerExport | undefined,
  data: SummonerRecommendData,
  config: RankWeightingConfig = DEFAULT_CONFIG,
  summonerConfig: SummonerConfig = DEFAULT_SUMMONER_CONFIG,
): SummonerRecommendationResult {
  const myRole: Role = input.userRole;
  const mix = computeEnemyDamageMix(
    input.enemies.map((s) => s.championId),
    data.tags,
  );

  const base = {
    schemaVersion: SUMMONER_RESULT_SCHEMA_VERSION,
    championId,
    myRole,
    damageMix: mix,
  } as const;

  const userBucket = config.evidenceMasterPlusOnly ? 'MASTER_PLUS' : rankToBucket(input.userRank);
  // A mismatched export (wrong champion or role file) is treated as absent
  // rather than silently recommending another champion's pairs.
  const usable =
    summonerExport !== undefined &&
    summonerExport.championId === championId &&
    summonerExport.myRole === myRole
      ? summonerExport
      : undefined;
  const bucketContexts = (usable?.contexts ?? []).filter((c) => c.rankBucket === userBucket);

  // Match the draft's back-off keys against the export, most specific first.
  const byKey = new Map<string, SummonerContextEntry>();
  for (const entry of bucketContexts) {
    if (!byKey.has(entry.contextKey)) byKey.set(entry.contextKey, entry);
  }
  const matched = contextKeys(
    input,
    myRole,
    data.roleProb,
    summonerConfig.laneGroups,
    data.tags,
    config,
  )
    .map((key) => byKey.get(key))
    .filter((e): e is SummonerContextEntry => e !== undefined)
    .map(aggregateContextPairs)
    .filter((c): c is ScoredContext => c !== null)
    .sort((a, b) => a.contextLevel - b.contextLevel || a.contextKey.localeCompare(b.contextKey));

  if (matched.length === 0) {
    return { ...base, pairs: [], dataAvailable: false };
  }

  const k = summonerConfig.kSummoner;
  const m = matched.length;

  // Pooled estimate per context, broadest first (same chain as runes).
  const ctxEst: number[] = new Array<number>(m).fill(GLOBAL_PRIOR);
  for (let j = m - 1; j >= 0; j--) {
    const ctx = matched[j];
    if (ctx === undefined) continue;
    const prior = j === m - 1 ? GLOBAL_PRIOR : ctxEst[j + 1];
    ctxEst[j] = shrink(ctx.totalWinsE, ctx.totalGamesE, k, prior ?? GLOBAL_PRIOR);
  }

  // Pair estimate at context j, shrunk toward the same pair's estimate at
  // the nearest broader context where it has data; when the pair is absent
  // from every broader context, toward that context's pooled estimate.
  const memo = new Map<string, number>();
  const estPair = (key: string, j: number): number => {
    const memoKey = `${String(j)} ${key}`;
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
    const ctx = matched[j];
    const agg = ctx?.pairs.get(key);
    if (ctx === undefined || agg === undefined) return GLOBAL_PRIOR;
    let prior = GLOBAL_PRIOR;
    let found = false;
    for (let kIdx = j + 1; kIdx < m; kIdx++) {
      if (matched[kIdx]?.pairs.has(key)) {
        prior = estPair(key, kIdx);
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

  // Score every pair once, at the most specific context where it appears.
  const scored = new Map<string, { ctx: ScoredContext; agg: PairAgg; score: number }>();
  for (let j = 0; j < m; j++) {
    const ctx = matched[j];
    if (ctx === undefined) continue;
    for (const [key, agg] of ctx.pairs) {
      if (scored.has(key)) continue;
      scored.set(key, { ctx, agg, score: estPair(key, j) });
    }
  }

  // Sufficient picks (D-102 gate) fill the display slots first: a thin
  // pair never outranks one that meets the evidence threshold, so the
  // setup screen cannot report insufficient data while a usable
  // recommendation was pushed out of the top `topPairs` (BL-031b review).
  // Within each class the shrunk score ranks, pick share breaks ties.
  const ranked = [...scored.entries()]
    .map(([key, s]) => ({ key, ...s }))
    .sort(
      (a, b) =>
        Number(meetsEvidenceGate(b.agg.gamesE, b.agg.players, config)) -
          Number(meetsEvidenceGate(a.agg.gamesE, a.agg.players, config)) ||
        b.score - a.score ||
        b.agg.pickShare - a.agg.pickShare ||
        a.key.localeCompare(b.key),
    )
    .slice(0, Math.max(0, summonerConfig.topPairs));

  const pairs: SummonerPairPick[] = ranked.map(({ ctx, agg, score }) => ({
    summoner1Id: agg.summoner1Id,
    summoner2Id: agg.summoner2Id,
    winRate: score,
    nEff: agg.gamesE,
    ...(agg.players !== undefined ? { players: agg.players } : {}),
    pickShare: agg.pickShare,
    lowData: isLowData(agg.gamesE, config.minGames),
    contextKey: ctx.contextKey,
    contextLevel: ctx.contextLevel,
  }));

  return { ...base, pairs, dataAvailable: true };
}
