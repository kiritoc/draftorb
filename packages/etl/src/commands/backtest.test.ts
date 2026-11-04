import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import { openDb, migrate } from '../db';
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
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count)
       VALUES ('m1', 'euw1', '16.20', 420, 1800, 1, 2500, 10),
              ('m2', 'euw1', '16.20', 420, 1800, 2, 2500, 10),
              ('m3', 'euw1', '16.21', 420, 1800, 3, 2500, 10),
              ('m4', 'euw1', '16.21', 420, 1800, 4, 2500, 10)`,
    ).run();
    // Every match: 5 blue (team 100), 5 red (team 200), TOP is champion 100 on both sides.
    // Blue wins m1, m3; red wins m2, m4 -> planted TOP effect.
    for (const [matchId, blueWins] of [
      ['m1', true],
      ['m2', false],
      ['m3', true],
      ['m4', false],
    ]) {
      for (let i = 0; i < 5; i += 1) {
        const puuidBlue = `puuid-${matchId}-${100 + i}`;
        const puuidRed = `puuid-${matchId}-${200 + i}`;
        db.prepare(
          `INSERT INTO participants (match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games, keystone, primary_style, sub_style, perks_json, items_json, kills, deaths, assists)
           VALUES (?, '${puuidBlue}', ${100 + i}, ${i === 0 ? 100 : 1000 + i}, '${['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'][i]}', ${blueWins ? 1 : 0}, 2500, 0, 8000, 8000, 8400, '[]', '[]', 0, 0, 0)`,
        ).run(matchId);
        db.prepare(
          `INSERT INTO participants (match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games, keystone, primary_style, sub_style, perks_json, items_json, kills, deaths, assists)
           VALUES (?, '${puuidRed}', ${200 + i}, ${i === 0 ? 100 : 2000 + i}, '${['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'][i]}', ${blueWins ? 0 : 1}, 2500, 0, 8000, 8000, 8400, '[]', '[]', 0, 0, 0)`,
        ).run(matchId);
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
    expect(report.trainingGames).toBe(20);
    expect(report.holdoutGames).toBe(20);
    expect(report.insufficientData).toBe(false);
    expect(report.logLoss).toBeLessThan(report.baselineLogLoss!);
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
