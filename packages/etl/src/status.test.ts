import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { migrate, openDb } from './db';
import { formatEtlStatus, getEtlStatus } from './status';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../migrations');

function seedPart(
  db: ReturnType<typeof openDb>,
  matchId: string,
  puuid: string,
  champId: number,
): void {
  db.prepare(
    `INSERT INTO participants (
      match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
      mastery_points, is_expert, keystone, primary_style, sub_style, perks_json,
      items_json, kills, deaths, assists
    ) VALUES (?, ?, 100, ?, 'TOP', 1, 6.75, 0, null, null, 8000, 8000, 8100, '{}', '[]', 2, 1, 5)`,
  ).run(matchId, puuid, champId);
}

describe('getEtlStatus and formatEtlStatus', () => {
  it('returns all zeros and migration status for an empty, migrated in-memory DB', () => {
    const db = openDb(':memory:');
    try {
      migrate(db);
      const status = getEtlStatus(db);

      expect(status.migrations.applied).toBeGreaterThan(0);
      expect(status.migrations.pending).toBe(0);
      expect(status.migrations.missingVersions).toEqual([]);
      expect(status.players).toEqual([]);
      expect(status.matches).toEqual([]);
      expect(status.participants).toBe(0);
      expect(status.cursors).toEqual([]);
      expect(status.rejects).toEqual([]);

      const formatted = formatEtlStatus(status);
      expect(formatted).toContain(`${status.migrations.applied} applied, 0 pending`);
      expect(formatted).toContain('Players: 0');
      expect(formatted).toContain('Matches: 0');
      expect(formatted).toContain('Participants: 0');
      expect(formatted).toContain('Match cursors: 0');
      expect(formatted).toContain('Rejects (global): 0');
    } finally {
      db.close();
    }
  });

  it('handles database migrated only through 001 and 002 without rank_known_count column', () => {
    const db = openDb(':memory:');
    try {
      db.exec(`
        CREATE TABLE _migrations (
          version TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL,
          checksum TEXT
        )
      `);
      for (const ver of ['001_initial', '002_match_rejects']) {
        const sql = readFileSync(join(MIGRATIONS_DIR, `${ver}.sql`), 'utf8');
        db.exec(sql);
        db.prepare('INSERT INTO _migrations VALUES (?, ?, ?)').run(ver, 1, 'mock');
      }

      db.prepare(
        `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score)
         VALUES ('EUW1_OLD', 'euw1', '14.1', 420, 1500, 1000, 6.5)`,
      ).run();

      const status = getEtlStatus(db);
      expect(status.migrations.applied).toBe(2);
      expect(status.migrations.pending).toBeGreaterThan(0);
      expect(status.matches).toHaveLength(1);
      expect(status.matches[0]?.rankKnownCount1).toBeUndefined();

      const formatted = formatEtlStatus(status);
      expect(formatted).toContain('euw1 / 14.1: 1');
      expect(formatted).not.toContain('rank_known_count');
    } finally {
      db.close();
    }
  });

  it('operates on a readonly unmigrated database without throwing or creating tables', () => {
    const db = openDb(':memory:');
    try {
      const status = getEtlStatus(db);
      expect(status.migrations.applied).toBe(0);
      expect(status.migrations.pending).toBeGreaterThan(0);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
        .all();
      expect(tables).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('returns exact counts for a seeded DB (2 players, 2 matches on 2 patches, 1 partial and 1 done cursor, 1 short reject)', () => {
    const db = openDb(':memory:');
    try {
      migrate(db);

      const insertPlayer = db.prepare(
        `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insertPlayer.run('p-alpha', 'euw1', 'DIAMOND', 'I', 50, 6.75, 1000);
      insertPlayer.run('p-beta', 'euw1', 'EMERALD', 'II', 20, 5.5, 1000);

      const insertMatch = db.prepare(
        `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count, fetched_timeline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertMatch.run('EUW1_101', 'euw1', '14.5', 420, 1500, 1000, 6.75, 1, 0);
      insertMatch.run('EUW1_102', 'euw1', '14.6', 420, 1600, 2000, 6.0, 2, 0);

      seedPart(db, 'EUW1_101', 'p-alpha', 1);
      seedPart(db, 'EUW1_102', 'p-beta', 2);

      const insertCursor = db.prepare('INSERT INTO ingest_state (key, value) VALUES (?, ?)');
      insertCursor.run(
        'match-ingest:euw1:p-alpha',
        JSON.stringify({ status: 'done', processed: 10, snapshot: [] }),
      );
      insertCursor.run(
        'match-ingest:euw1:p-beta',
        JSON.stringify({ status: 'partial', processed: 5, snapshot: [] }),
      );

      db.prepare(
        `INSERT INTO match_rejects (match_id, reason, patch, checked_at)
         VALUES (?, ?, ?, ?)`,
      ).run('EUW1_REJECT_1', 'short', '14.5', 1000);

      const status = getEtlStatus(db);

      expect(status.players).toEqual([
        { platform: 'euw1', tier: 'DIAMOND', count: 1 },
        { platform: 'euw1', tier: 'EMERALD', count: 1 },
      ]);
      expect(status.matches).toEqual([
        { platform: 'euw1', patch: '14.5', count: 1, rankKnownCount1: 1 },
        { platform: 'euw1', patch: '14.6', count: 1, rankKnownCount1: 0 },
      ]);
      expect(status.participants).toBe(2);
      expect(status.cursors).toEqual([{ platform: 'euw1', done: 1, partial: 1 }]);
      expect(status.rejects).toEqual([{ reason: 'short', count: 1 }]);

      const formatted = formatEtlStatus(status);
      expect(formatted).toContain('Players (2):');
      expect(formatted).toContain('euw1 / DIAMOND: 1');
      expect(formatted).toContain('euw1 / EMERALD: 1');
      expect(formatted).toContain('Matches (2):');
      expect(formatted).toContain('euw1 / 14.5: 1 (1 with rank_known_count = 1)');
      expect(formatted).toContain('euw1 / 14.6: 1 (0 with rank_known_count = 1)');
      expect(formatted).toContain('Participants: 2');
      expect(formatted).toContain('Match cursors:');
      expect(formatted).toContain('euw1: 1 done, 1 partial');
      expect(formatted).toContain('Rejects (global, 1):');
      expect(formatted).toContain('short: 1');
    } finally {
      db.close();
    }
  });

  it('filters results by platform when platform is specified', () => {
    const db = openDb(':memory:');
    try {
      migrate(db);

      db.prepare(
        `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('p-eu', 'euw1', 'DIAMOND', 'I', 50, 6.75, 1000);
      db.prepare(
        `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('p-na', 'na1', 'MASTER', 'I', 100, 7.0, 1000);

      db.prepare(
        `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count, fetched_timeline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('EUW1_101', 'euw1', '14.5', 420, 1500, 1000, 6.75, 1, 0);
      db.prepare(
        `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count, fetched_timeline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('NA1_201', 'na1', '14.5', 420, 1500, 1000, 7.0, 1, 0);

      seedPart(db, 'EUW1_101', 'p-eu', 1);
      seedPart(db, 'NA1_201', 'p-na', 2);

      db.prepare('INSERT INTO ingest_state (key, value) VALUES (?, ?)').run(
        'match-ingest:euw1:p-eu',
        JSON.stringify({ status: 'done' }),
      );
      db.prepare('INSERT INTO ingest_state (key, value) VALUES (?, ?)').run(
        'match-ingest:na1:p-na',
        JSON.stringify({ status: 'partial' }),
      );

      const euStatus = getEtlStatus(db, 'euw1');
      expect(euStatus.players).toEqual([{ platform: 'euw1', tier: 'DIAMOND', count: 1 }]);
      expect(euStatus.matches).toEqual([
        { platform: 'euw1', patch: '14.5', count: 1, rankKnownCount1: 1 },
      ]);
      expect(euStatus.participants).toBe(1);
      expect(euStatus.cursors).toEqual([{ platform: 'euw1', done: 1, partial: 0 }]);

      const naStatus = getEtlStatus(db, 'na1');
      expect(naStatus.players).toEqual([{ platform: 'na1', tier: 'MASTER', count: 1 }]);
      expect(naStatus.matches).toEqual([
        { platform: 'na1', patch: '14.5', count: 1, rankKnownCount1: 1 },
      ]);
      expect(naStatus.participants).toBe(1);
      expect(naStatus.cursors).toEqual([{ platform: 'na1', done: 0, partial: 1 }]);

      const krStatus = getEtlStatus(db, 'kr');
      expect(krStatus.players).toEqual([]);
      expect(krStatus.matches).toEqual([]);
      expect(krStatus.participants).toBe(0);
      expect(krStatus.cursors).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('formats missing migration versions when present', () => {
    const status = {
      migrations: {
        applied: 2,
        pending: 3,
        missingVersions: ['999_missing'],
      },
      players: [],
      matches: [],
      participants: 0,
      cursors: [],
      rejects: [],
    };

    const formatted = formatEtlStatus(status);
    expect(formatted).toContain('Migrations: 2 applied, 3 pending (missing: 999_missing)');
  });
});
