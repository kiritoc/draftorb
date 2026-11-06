import type Database from 'better-sqlite3';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate, openDb } from './db';
import { seedPatches } from './patches.test-helpers';

export interface ToyGame {
  patch: string;
  rankScore: number;
  win: number;
  rankKnownCount?: number;
  championId?: number;
  role?: string;
  participantRankScore?: number | null;
}

export interface BaselineRow {
  championId: number;
  myRole: string;
  rankBucket: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  games: number;
}

let toyMatchIndex = 0;

export function seedGames(db: Database.Database, games: ToyGame[]): void {
  seedPatches(
    db,
    games.map((game) => game.patch),
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
    ) VALUES (?, ?, 100, ?, ?, ?, ?, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
  );
  for (const game of games) {
    toyMatchIndex += 1;
    const matchId = `toy${toyMatchIndex}`;
    insertMatch.run(matchId, game.patch, game.rankScore, game.rankKnownCount ?? 2);
    insertParticipant.run(
      matchId,
      `toy-p${toyMatchIndex}`,
      game.championId ?? 412,
      game.role ?? 'SUPPORT',
      game.win,
      game.participantRankScore === undefined ? game.rankScore : game.participantRankScore,
    );
  }
}

export function requireRow(
  rows: BaselineRow[],
  championId: number,
  myRole: string,
  rankBucket: string,
): BaselineRow {
  const row = rows.find(
    (r) => r.championId === championId && r.myRole === myRole && r.rankBucket === rankBucket,
  );
  if (!row) {
    throw new Error(
      `expected baseline row for champion ${championId} role ${myRole} bucket ${rankBucket}`,
    );
  }
  return row;
}

export function withFreshDb(run: (dbPath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'draftorb-baseline-'));
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

export function withSeededDb(games: ToyGame[], run: (db: Database.Database) => void): void {
  withFreshDb((dbPath) => {
    const db = openDb(dbPath);
    try {
      migrate(db);
      seedGames(db, games);
      run(db);
    } finally {
      db.close();
    }
  });
}

export function seedBasic(dbPath: string): void {
  const db = openDb(dbPath);
  migrate(db);
  seedPatches(db, ['16.21']);
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
    ) VALUES (?, ?, 100, ?, 'SUPPORT', ?, ?, 0, NULL, NULL, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
  );
  let matchIndex = 0;
  const addGame = (
    patch: string,
    rankKnownCount: number,
    rankScore: number | null,
    win: number,
  ): void => {
    const matchId = `m${(matchIndex += 1)}`;
    insertMatch.run(matchId, patch, rankScore, rankKnownCount);
    insertParticipant.run(matchId, `p${matchIndex}`, 412, win, rankScore);
  };
  // Patch 16.21 (current), full rank knowledge, all DIAMOND (bucket index 6).
  // 3 wins + 2 losses, weight 1 each for the DIAMOND user bucket.
  addGame('16.21', 2, 6.5, 1);
  addGame('16.21', 2, 6.5, 1);
  addGame('16.21', 2, 6.5, 1);
  addGame('16.21', 2, 6.5, 0);
  addGame('16.21', 2, 6.5, 0);
  // One game at SILVER (bucket index 2): weight 0 for the DIAMOND user bucket
  // (2 < 6 - rankWindowTiers(2) = 4), so it must not contribute there.
  addGame('16.21', 2, 2.5, 1);
  db.close();
}
