import type Database from 'better-sqlite3';

import { RiotClient, type Platform, type RiotLeagueEntry } from './riot';

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

const DIVISION_ORDER = ['I', 'II', 'III', 'IV'] as const;

export interface PlayerDiscoveryOptions {
  platform?: Platform;
  tiers?: readonly string[];
  quotas?: Partial<Record<string, number>>;
  db?: Database.Database;
  client?: RiotClient;
  reset?: boolean;
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

export function playerRankScore(
  tier: string,
  division?: string,
  lp: number = 0,
): number {
  const baseTierScore: Record<string, number> = {
    IRON: 0,
    BRONZE: 1,
    SILVER: 2,
    GOLD: 3,
    PLATINUM: 4,
    EMERALD: 5,
    DIAMOND: 6,
    MASTER: 7,
    GRANDMASTER: 7,
    CHALLENGER: 7,
  };

  const base = baseTierScore[tier.toUpperCase()] ?? 0;
  const normalizedDivision = division?.toUpperCase();
  const divisionIndex = normalizedDivision
    ? DIVISION_ORDER.findIndex((label) => label === normalizedDivision)
    : -1;
  const divisionBonus = divisionIndex >= 0 ? (divisionIndex + 1) * 0.15 : 0;
  const lpBonus = Math.min(Math.max(lp, 0), 100) / 100;
  return Number((base + divisionBonus + lpBonus).toFixed(2));
}

function toPlayerRow(entry: RiotLeagueEntry, platform: Platform, tier: string): {
  puuid: string;
  platform: string;
  tier: string;
  division: string;
  lp: number;
  rank_score: number;
  updated_at: number;
} {
  const division = (entry.rank ?? 'IV').toUpperCase();
  const puuid = entry.puuid ?? entry.summonerId ?? `${entry.leagueId ?? 'unknown'}:${entry.queueType}`;

  return {
    puuid,
    platform,
    tier: tier.toUpperCase(),
    division,
    lp: Number.isFinite(entry.leaguePoints) ? entry.leaguePoints : 0,
    rank_score: playerRankScore(
      tier,
      division,
      Number.isFinite(entry.leaguePoints) ? entry.leaguePoints : 0,
    ),
    updated_at: Date.now(),
  };
}

async function getTierEntries(client: RiotClient, platform: Platform, tier: string): Promise<RiotLeagueEntry[]> {
  const normalizedTier = tier.toUpperCase();

  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(normalizedTier)) {
    const league =
      normalizedTier === 'MASTER'
        ? await client.getMasterLeague(platform)
        : normalizedTier === 'GRANDMASTER'
          ? await client.getGrandmasterLeague(platform)
          : await client.getChallengerLeague(platform);

    return (league.entries ?? []).map((entry) => ({
      queueType: 'RANKED_SOLO_5x5',
      tier: normalizedTier,
      rank: typeof entry.rank === 'string' ? entry.rank : 'IV',
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
  }

  const entries: RiotLeagueEntry[] = [];
  for (const division of DIVISION_ORDER) {
    let page = 1;
    for (;;) {
      const pageEntries = await client.getLeagueEntries(
        platform,
        'RANKED_SOLO_5x5',
        normalizedTier,
        division,
        page,
      );

      if (pageEntries.length === 0) {
        break;
      }

      entries.push(...pageEntries);
      if (pageEntries.length < 100) {
        break;
      }
      page += 1;
    }
  }

  return entries;
}

function readProgress(db: Database.Database, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM ingest_state WHERE key = ?')
    .get(key) as { value: string } | undefined;

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
  const quotas = {
    ...DEFAULT_PLAYER_QUOTAS,
    ...options.quotas,
  };
  const client = options.client ?? new RiotClient({ autoLoadEnv: true });

  const db = options.db ?? (await import('./db')).openDb(process.env.DRAFTORB_DB_PATH ?? 'data/DraftOrb.sqlite');

  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'ingest_state'").get()) {
    const { migrate } = await import('./db');
    migrate(db);
  }

  const tierResults: TierDiscoveryResult[] = [];
  let totalFetched = 0;
  let totalStored = 0;

  for (const tier of tiers) {
    const normalizedTier = tier.toUpperCase();
    const quota = Math.max(0, quotas[normalizedTier] ?? 0);
    if (quota <= 0) {
      tierResults.push({ tier: normalizedTier, pageCount: 0, fetched: 0, stored: 0, status: 'skipped' });
      continue;
    }

    const stateKey = `player-discovery:${platform}:${normalizedTier}`;
    if (!options.reset) {
      const progress = readProgress(db, stateKey);
      if (progress) {
        const parsed = JSON.parse(progress) as { completed?: boolean };
        if (parsed.completed) {
          tierResults.push({ tier: normalizedTier, pageCount: 0, fetched: 0, stored: 0, status: 'skipped' });
          continue;
        }
      }
    }

    const entries = await getTierEntries(client, platform, normalizedTier);
    const rankedEntries = entries
      .filter((entry) => (entry.tier ?? '').toUpperCase() === normalizedTier)
      .filter((entry) => entry.puuid || entry.summonerId || entry.leagueId)
      .slice(0, quota);

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

    let stored = 0;
    for (const entry of rankedEntries) {
      const row = toPlayerRow(entry, platform, normalizedTier);
      upsert.run(row);
      stored += 1;
    }

    totalFetched += rankedEntries.length;
    totalStored += stored;
    writeProgress(
      db,
      stateKey,
      JSON.stringify({ completed: true, fetched: rankedEntries.length, stored, updatedAt: Date.now() }),
    );

    tierResults.push({
      tier: normalizedTier,
      pageCount: 1,
      fetched: rankedEntries.length,
      stored,
      status: rankedEntries.length < quota ? 'partial' : 'complete',
    });
  }

  return {
    platform,
    tiers,
    totalFetched,
    totalStored,
    tierResults,
  };
}

export async function runPlayerDiscovery(
  options: PlayerDiscoveryOptions = {},
): Promise<PlayerDiscoveryResult> {
  return discoverPlayersByTier(options);
}
