import type Database from 'better-sqlite3';

import { RiotClient, type Platform, type RiotLeagueEntry } from './riot';
import { resolveDbPath } from './config/paths';
import { migrate, openDb } from './db';
import { DIVISION_ORDER, getTierEntries, readProgress, writeProgress } from './players-tiers';

export const DEFAULT_PLAYER_TIER_SEQUENCE = [
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const;
export const DEFAULT_PLAYER_QUOTAS: Readonly<Record<string, number>> = {
  EMERALD: 250,
  DIAMOND: 250,
  MASTER: 150,
  GRANDMASTER: 100,
  CHALLENGER: 100,
} as const;
export const DEFAULT_MAX_AGE_DAYS = 7;

const TIER_BASE_SCORE: Readonly<Record<string, number>> = {
  IRON: 0,
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
  PLATINUM: 4,
  EMERALD: 5,
  DIAMOND: 6,
  MASTER: 7,
  GRANDMASTER: 8,
  CHALLENGER: 9,
};
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

export interface PlayerDiscoveryOptions {
  platform?: Platform;
  tiers?: readonly string[];
  quotas?: Partial<Record<string, number>>;
  db?: Database.Database;
  client?: RiotClient;
  reset?: boolean;
  maxAgeDays?: number;
}

export interface TierDiscoveryResult {
  tier: string;
  pageCount: number;
  fetched: number;
  stored: number;
  status: 'skipped' | 'partial' | 'complete';
}

export interface PlayerDiscoveryResult {
  platform: Platform;
  tiers: string[];
  totalFetched: number;
  totalStored: number;
  tierResults: TierDiscoveryResult[];
}

function normalizeTierList(tiers?: readonly string[]): string[] {
  if (!tiers || tiers.length === 0) {
    return [...DEFAULT_PLAYER_TIER_SEQUENCE];
  }

  return [...new Set(tiers.map((tier) => tier.toUpperCase()))];
}

export function playerRankScore(tier: string, division?: string): number {
  const normalizedTier = tier.toUpperCase();
  const base = TIER_BASE_SCORE[normalizedTier] ?? 0;
  const normalizedDivision = division?.toUpperCase();
  const divisionIndex = normalizedDivision
    ? DIVISION_ORDER.findIndex((label) => label === normalizedDivision)
    : -1;
  const isApex = APEX_TIERS.has(normalizedTier);
  const divisionBonus =
    !isApex && divisionIndex >= 0 ? (DIVISION_ORDER.length - 1 - divisionIndex) * 0.25 : 0;
  return base + divisionBonus;
}

function toPlayerRow(
  entry: RiotLeagueEntry,
  platform: Platform,
  tier: string,
): {
  puuid: string;
  platform: string;
  tier: string;
  division: string;
  lp: number;
  rank_score: number;
  updated_at: number;
} {
  const division = (entry.rank ?? 'I').toUpperCase();
  const puuid = entry.puuid as string;

  return {
    puuid,
    platform,
    tier: tier.toUpperCase(),
    division,
    lp: Number.isFinite(entry.leaguePoints) ? entry.leaguePoints : 0,
    rank_score: playerRankScore(tier, division),
    updated_at: Date.now(),
  };
}

export async function discoverPlayersByTier(
  options: PlayerDiscoveryOptions = {},
): Promise<PlayerDiscoveryResult> {
  const platform = options.platform ?? 'euw1';
  const tiers = normalizeTierList(options.tiers);
  const quotas = { ...DEFAULT_PLAYER_QUOTAS, ...options.quotas };
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const ownsDb = options.db === undefined;
  const db = options.db ?? openDb(resolveDbPath());
  try {
    migrate(db);

    const tierResults: TierDiscoveryResult[] = [];
    let totalFetched = 0;
    let totalStored = 0;

    for (const tier of tiers) {
      const normalizedTier = tier.toUpperCase();
      const quota = Math.max(0, quotas[normalizedTier] ?? 0);
      if (quota <= 0) {
        tierResults.push({
          tier: normalizedTier,
          pageCount: 0,
          fetched: 0,
          stored: 0,
          status: 'skipped',
        });
        continue;
      }

      const stateKey = `player-discovery:${platform}:${normalizedTier}`;
      if (!options.reset) {
        const progress = readProgress(db, stateKey);
        if (progress) {
          let parsed: { completed?: boolean; updatedAt?: number; status?: string } = {};
          try {
            parsed = JSON.parse(progress) as {
              completed?: boolean;
              updatedAt?: number;
              status?: string;
            };
          } catch {
            /* corrupted state: redo this tier */
          }
          const recent =
            typeof parsed.updatedAt === 'number' && Date.now() - parsed.updatedAt <= maxAgeMs;
          if (parsed.completed === true && recent) {
            tierResults.push({
              tier: normalizedTier,
              pageCount: 0,
              fetched: 0,
              stored: 0,
              status: 'skipped',
            });
            continue;
          }
        }
      }

      const { entries, pageCount, exhausted, cappedHasRejected } = await getTierEntries(
        client,
        platform,
        normalizedTier,
        quota,
      );
      const rankedEntries = entries
        .filter((entry) => (entry.tier ?? '').toUpperCase() === normalizedTier)
        .slice(0, quota)
        .filter((entry) => typeof entry.puuid === 'string' && entry.puuid.length > 0);

      const upsert = db.prepare(`
      INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
      VALUES (@puuid, @platform, @tier, @division, @lp, @rank_score, @updated_at)
      ON CONFLICT(puuid) DO UPDATE SET
        platform = excluded.platform,
        tier = excluded.tier,
        division = excluded.division,
        lp = excluded.lp,
        rank_score = excluded.rank_score,
        updated_at = excluded.updated_at
    `);

      const storeAll = db.transaction((list: RiotLeagueEntry[]) => {
        for (const entry of list) upsert.run(toPlayerRow(entry, platform, normalizedTier));
        return list.length;
      });
      const stored = storeAll(rankedEntries);
      const completed = rankedEntries.length >= quota || (exhausted && !cappedHasRejected);

      totalFetched += rankedEntries.length;
      totalStored += stored;
      writeProgress(
        db,
        stateKey,
        JSON.stringify({
          completed,
          status: completed ? 'complete' : 'partial',
          fetched: rankedEntries.length,
          stored,
          updatedAt: Date.now(),
          pageCount,
        }),
      );

      tierResults.push({
        tier: normalizedTier,
        pageCount,
        fetched: rankedEntries.length,
        stored,
        status: completed ? 'complete' : 'partial',
      });
    }

    return {
      platform,
      tiers,
      totalFetched,
      totalStored,
      tierResults,
    };
  } finally {
    if (ownsDb) db.close();
  }
}

export async function runPlayerDiscovery(
  options: PlayerDiscoveryOptions = {},
): Promise<PlayerDiscoveryResult> {
  return discoverPlayersByTier(options);
}
