import type Database from 'better-sqlite3';

import { RiotClient, type Platform, type RiotLeagueEntry } from './riot';
import { resolveDbPath } from './config/paths';
import { migrate, openDb } from './db';

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

const DIVISION_ORDER = ['I', 'II', 'III', 'IV'] as const;
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

async function getTierEntries(
  client: RiotClient,
  platform: Platform,
  tier: string,
  quota: number,
): Promise<{ entries: RiotLeagueEntry[]; pageCount: number }> {
  const normalizedTier = tier.toUpperCase();
  let pageCount = 0;

  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(normalizedTier)) {
    const league =
      normalizedTier === 'MASTER'
        ? await client.getMasterLeague(platform)
        : normalizedTier === 'GRANDMASTER'
          ? await client.getGrandmasterLeague(platform)
          : await client.getChallengerLeague(platform);
    const entries = (league.entries ?? [])
      .filter((entry) => typeof entry.puuid === 'string')
      .sort((a, b) => b.leaguePoints - a.leaguePoints)
      .slice(0, quota)
      .map((entry) => ({
        queueType: 'RANKED_SOLO_5x5',
        tier: normalizedTier,
        rank: 'I',
        leaguePoints: Number.isFinite(entry.leaguePoints) ? entry.leaguePoints : 0,
        wins: Number.isFinite(entry.wins) ? entry.wins : 0,
        losses: Number.isFinite(entry.losses) ? entry.losses : 0,
        puuid: typeof entry.puuid === 'string' ? entry.puuid : undefined,
        summonerId: typeof entry.summonerId === 'string' ? entry.summonerId : undefined,
        leagueId: typeof entry.leagueId === 'string' ? entry.leagueId : undefined,
        veteran: typeof entry.veteran === 'boolean' ? entry.veteran : undefined,
        inactive: typeof entry.inactive === 'boolean' ? entry.inactive : undefined,
        freshBlood: typeof entry.freshBlood === 'boolean' ? entry.freshBlood : undefined,
        hotStreak: typeof entry.hotStreak === 'boolean' ? entry.hotStreak : undefined,
      }));
    return { entries, pageCount: 1 };
  }

  const perDivision = Math.ceil(quota / DIVISION_ORDER.length);
  const entries: RiotLeagueEntry[] = [];
  for (const division of DIVISION_ORDER) {
    const seen = new Set<string>();
    const divisionEntries: RiotLeagueEntry[] = [];
    let page = 1;
    while (seen.size < perDivision) {
      pageCount += 1;
      const pageEntries = await client.getLeagueEntries(
        platform,
        'RANKED_SOLO_5x5',
        normalizedTier,
        division,
        page,
      );
      if (pageEntries.length === 0) break;
      for (const e of pageEntries) {
        if (e.puuid && !seen.has(e.puuid)) {
          seen.add(e.puuid);
          divisionEntries.push(e);
        }
      }
      if (pageEntries.length < 100) break;
      page += 1;
    }
    entries.push(...divisionEntries.slice(0, perDivision));
  }

  return {
    entries: entries.filter((entry) => typeof entry.puuid === 'string').slice(0, quota),
    pageCount,
  };
}

function readProgress(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM ingest_state WHERE key = ?').get(key) as
    { value: string } | undefined;

  return row?.value ?? null;
}

function writeProgress(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO ingest_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
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

      const { entries, pageCount } = await getTierEntries(client, platform, normalizedTier, quota);
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
      const completed = rankedEntries.length >= quota || pageCount > 0;

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
