import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import { openDb, migrate } from '../db';
import { seedGames } from '../aggregate-baseline-helpers';
import { seedPatches } from '../patches.test-helpers';
import { backtestCommand } from './backtest';

describe('backtestCommand', () => {
  let directory: string;
  let dbPath: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalDbPath = process.env.DRAFTORB_DB_PATH;
  const originalPublicDir = process.env.DRAFTORB_PUBLIC_DIR;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-backtest-'));
    dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    process.env.DRAFTORB_PUBLIC_DIR = join(directory, 'public');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalDbPath === undefined) {
      delete process.env.DRAFTORB_DB_PATH;
    } else {
      process.env.DRAFTORB_DB_PATH = originalDbPath;
    }
    if (originalPublicDir === undefined) {
      delete process.env.DRAFTORB_PUBLIC_DIR;
    } else {
      process.env.DRAFTORB_PUBLIC_DIR = originalPublicDir;
    }
    rmSync(directory, { recursive: true, force: true });
  });

  const seed = (db: Database.Database) => {
    seedPatches(db, ['16.20', '16.21']);
    const insertMatch = db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count)
       VALUES (?, 'euw1', ?, 420, 1800, ?, 6.5, 10)`,
    );
    const insertParticipant = db.prepare(
      `INSERT INTO participants (match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games, keystone, primary_style, sub_style, perks_json, items_json, kills, deaths, assists)
       VALUES (?, ?, ?, ?, ?, ?, 6.5, 0, 8000, 8000, 8400, '[]', '[]', 0, 0, 0)`,
    );
    const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const;
    const matches = [
      ...Array.from({ length: 30 }, (_, i) => ({
        matchId: `train-${i}`,
        patch: '16.20',
        createdAt: i + 1,
        blueWins: i % 2 === 0,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        matchId: `holdout-${i}`,
        patch: '16.21',
        createdAt: 100 + i,
        blueWins: i % 2 === 0,
      })),
    ];

    for (const match of matches) {
      insertMatch.run(match.matchId, match.patch, match.createdAt);
      // TOP is champion 100 on both teams; other roles use one consistent champion per side.
      for (const [teamId, teamWins] of [
        [100, match.blueWins],
        [200, !match.blueWins],
      ] as const) {
        for (const [i, role] of roles.entries()) {
          const championId = i === 0 ? 100 : teamId * 10 + i;
          insertParticipant.run(
            match.matchId,
            `puuid-${match.matchId}-${teamId}-${i}`,
            teamId,
            championId,
            role,
            teamWins ? 1 : 0,
          );
        }
      }
    }
  };

  it('writes a backtest-draft.json report for a seeded database', async () => {
    const db = openDb(dbPath);
    migrate(db);
    seed(db);
    db.close();

    await backtestCommand.run(['draft']);

    const report = JSON.parse(
      readFileSync(join(process.env.DRAFTORB_PUBLIC_DIR as string, 'backtest-draft.json'), 'utf8'),
    );
    expect(report.holdoutPatch).toBe('16.21');
    expect(report.trainingPatches).toEqual(['16.20']);
    expect(report.trainingGames).toBe(30);
    expect(report.holdoutGames).toBe(5);
    expect(report.insufficientData).toBe(false);
    expect(report.validationStatus).toBe('unvalidated');
    expect(report.logLoss).toBeTypeOf('number');
  });

  it('writes the report to a custom --out path', async () => {
    const db = openDb(dbPath);
    migrate(db);
    seed(db);
    db.close();

    const customOut = join(directory, 'reports', 'custom-backtest.json');
    await backtestCommand.run(['draft', `--out=${customOut}`]);

    const report = JSON.parse(readFileSync(customOut, 'utf8'));
    expect(report.holdoutPatch).toBe('16.21');
    expect(report.insufficientData).toBe(false);
  });

  it('evaluates holdout players at the match rank when participant rank is unknown', async () => {
    const db = openDb(dbPath);
    migrate(db);
    seedGames(db, [
      ...Array.from({ length: 30 }, (_, i) => ({
        patch: '16.20',
        rankScore: 0.5,
        win: i % 2,
        participantRankScore: null,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        patch: '16.21',
        rankScore: 6.5,
        win: i % 2,
        participantRankScore: null,
      })),
    ]);
    db.close();

    const customOut = join(directory, 'reports', 'match-rank-backtest.json');
    await backtestCommand.run(['draft', `--out=${customOut}`]);

    const report = JSON.parse(readFileSync(customOut, 'utf8'));
    expect(report.holdoutPatch).toBe('16.21');
    expect(report.insufficientData).toBe(true);
    expect(report.message).toMatch(/No holdout pick was scored/);
  });

  it('rejects a duplicate or empty --out option', async () => {
    await expect(backtestCommand.run(['draft', '--out=a.json', '--out=b.json'])).rejects.toThrow(
      /Duplicate --out/,
    );
    await expect(backtestCommand.run(['draft', '--out='])).rejects.toThrow(/Missing value/);
  });

  it('reports insufficient data when there are no matches', async () => {
    const db = openDb(dbPath);
    migrate(db);
    db.close();

    await backtestCommand.run(['draft']);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toMatch(/no database|nothing to backtest|insufficient data/i);
  });

  it('rejects an unknown subcommand with a usage error', async () => {
    await expect(backtestCommand.run(['bogus'])).rejects.toThrow(/Unknown backtest subcommand/);
  });
});
