/**
 * @draftorb/etl — Tier-entry fetching and ingest-progress helpers for player
 * discovery. Split out of players.ts (file size); pure move, no logic change.
 */

import type Database from 'better-sqlite3';

import type { Platform, RiotClient, RiotLeagueEntry } from './riot';

export const DIVISION_ORDER = ['I', 'II', 'III', 'IV'] as const;

export async function getTierEntries(
  client: RiotClient,
  platform: Platform,
  tier: string,
  quota: number,
): Promise<{
  entries: RiotLeagueEntry[];
  pageCount: number;
  exhausted: boolean;
  cappedHasRejected: boolean;
}> {
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
    return { entries, pageCount: 1, exhausted: true, cappedHasRejected: false };
  }

  const perDivision = Math.ceil(quota / DIVISION_ORDER.length);
  const entries: RiotLeagueEntry[] = [];
  let divisionsExhausted = 0;
  let cappedHasRejected = false;
  for (const division of DIVISION_ORDER) {
    const seen = new Set<string>();
    const divisionEntries: RiotLeagueEntry[] = [];
    let page = 1;
    let divisionExhausted = false;
    while (seen.size < perDivision) {
      pageCount += 1;
      const pageEntries = await client.getLeagueEntries(
        platform,
        'RANKED_SOLO_5x5',
        normalizedTier,
        division,
        page,
      );
      if (pageEntries.length === 0) {
        divisionExhausted = true;
        break;
      }
      for (const e of pageEntries) {
        if (e.puuid && !seen.has(e.puuid)) {
          seen.add(e.puuid);
          divisionEntries.push(e);
        }
      }
      if (pageEntries.length < 100) {
        divisionExhausted = true;
        break;
      }
      page += 1;
    }
    if (divisionExhausted) divisionsExhausted += 1;
    else if (
      divisionEntries
        .slice(0, perDivision)
        .some((e) => (e.tier ?? '').toUpperCase() !== normalizedTier)
    ) {
      cappedHasRejected = true;
    }
    entries.push(...divisionEntries.slice(0, perDivision));
  }

  return {
    entries: entries.filter((entry) => typeof entry.puuid === 'string').slice(0, quota),
    pageCount,
    exhausted: divisionsExhausted > 0,
    cappedHasRejected,
  };
}

export function readProgress(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM ingest_state WHERE key = ?').get(key) as
    { value: string } | undefined;

  return row?.value ?? null;
}

export function writeProgress(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO ingest_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
