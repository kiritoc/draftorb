import type Database from 'better-sqlite3';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate, openDb } from './db';
import { seedPatches } from './patches.test-helpers';

export interface PairRow {
  championId: number;
  myRole: string;
  otherChampionId: number;
  otherRole: string;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface LaneVsRow {
  championId: number;
  myRole: string;
  opp1Id: number;
  opp2Id: number | null;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface LaneFullRow {
  championId: number;
  myRole: string;
  partnerId: number | null;
  opp1Id: number;
  opp2Id: number;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

export interface ToyParticipant {
  championId: number;
  role: string;
  win: number;
  teamId: number;
  puuid: string;
  rankScore?: number;
}

export interface ToyMatch {
  patch: string;
  rankKnownCount?: number;
  participants: ToyParticipant[];
}

let toyMatchIndex = 0;

/**
 * Seeds one match with multiple participants (one row per participant).
 * All participants share the same patch / rankKnownCount / avg_rank_score.
 */
export function seedMatches(db: Database.Database, matches: ToyMatch[]): void {
  seedPatches(
    db,
    matches.map((match) => match.patch),
  );
  const insertMatch = db.prepare(
    `INSERT INTO matches (
      match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
    ) VALUES (?, 'euw1', ?, 420, 1800, 1, ?, ?)`,
  );
  const insertParticipant = db.prepare(
    `INSERT INTO participants (
      match_id, puuid, team_id, champion_id, role, win, rank_score,
      champion_games, mastery_points, is_expert, keystone, primary_style,
      sub_style, perks_json, items_json, kills, deaths, assists
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
  );
  for (const match of matches) {
    toyMatchIndex += 1;
    const matchId = `toy${toyMatchIndex}`;
    const rankKnownCount = match.rankKnownCount ?? 2;
    insertMatch.run(matchId, match.patch, 6.5, rankKnownCount);
    for (const p of match.participants) {
      insertParticipant.run(
        matchId,
        p.puuid,
        p.teamId,
        p.championId,
        p.role,
        p.win,
        p.rankScore ?? 6.5,
      );
    }
  }
}

export function requirePairRow(
  rows: PairRow[],
  championId: number,
  myRole: string,
  otherChampionId: number,
  otherRole: string,
  rankBucket: string,
): PairRow {
  const row = rows.find(
    (r) =>
      r.championId === championId &&
      r.myRole === myRole &&
      r.otherChampionId === otherChampionId &&
      r.otherRole === otherRole &&
      r.rankBucket === rankBucket,
  );
  if (!row) {
    throw new Error(
      `expected pair row for champion ${championId} role ${myRole} other ${otherChampionId}(${otherRole}) bucket ${rankBucket}`,
    );
  }
  return row;
}

export function requireLaneVsRow(
  rows: LaneVsRow[],
  championId: number,
  myRole: string,
  opp1Id: number,
  opp2Id: number | null,
  rankBucket: string,
): LaneVsRow {
  const row = rows.find(
    (r) =>
      r.championId === championId &&
      r.myRole === myRole &&
      r.opp1Id === opp1Id &&
      r.opp2Id === opp2Id &&
      r.rankBucket === rankBucket,
  );
  if (!row) {
    throw new Error(
      `expected lane_vs row for champion ${championId} role ${myRole} opp1 ${opp1Id} opp2 ${opp2Id} bucket ${rankBucket}`,
    );
  }
  return row;
}

export function requireLaneFullRow(
  rows: LaneFullRow[],
  championId: number,
  myRole: string,
  partnerId: number | null,
  opp1Id: number,
  opp2Id: number,
  rankBucket: string,
): LaneFullRow {
  const row = rows.find(
    (r) =>
      r.championId === championId &&
      r.myRole === myRole &&
      r.partnerId === partnerId &&
      r.opp1Id === opp1Id &&
      r.opp2Id === opp2Id &&
      r.rankBucket === rankBucket,
  );
  if (!row) {
    throw new Error(
      `expected lane_full row for champion ${championId} role ${myRole} partner ${partnerId} opp1 ${opp1Id} opp2 ${opp2Id} bucket ${rankBucket}`,
    );
  }
  return row;
}

export function withFreshDb(run: (dbPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-pairs-'));
  const dbPath = join(directory, 'test.sqlite');
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  process.env.DRAFTORB_DB_PATH = dbPath;
  try {
    run(dbPath);
  } finally {
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

export function withSeededDb(matches: ToyMatch[], run: (db: Database.Database) => void): void {
  withFreshDb((dbPath) => {
    const db = openDb(dbPath);
    try {
      migrate(db);
      seedMatches(db, matches);
      run(db);
    } finally {
      db.close();
    }
  });
}
