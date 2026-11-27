import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import { openDb, migrate } from '../db';
import { seedGames } from '../aggregate-baseline-helpers';
import { seedPatches } from '../patches.test-helpers';
import type { Role } from '@draftorb/shared';
import type { DraftRow } from '../backtest/draft';
import { backtestCommand, buildEngineData, runMatchupExperiment } from './backtest';

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

  it('runs the D-129 matchup experiment when a train-only validation patch exists', async () => {
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.19', '16.20', '16.21']);
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
      ...Array.from({ length: 15 }, (_, i) => ({
        matchId: `p19-${i}`,
        patch: '16.19',
        createdAt: i + 1,
        blueWins: i % 2 === 0,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        matchId: `p20-${i}`,
        patch: '16.20',
        createdAt: 100 + i,
        blueWins: i % 2 === 0,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        matchId: `p21-${i}`,
        patch: '16.21',
        createdAt: 200 + i,
        blueWins: i % 2 === 0,
      })),
    ];
    for (const match of matches) {
      insertMatch.run(match.matchId, match.patch, match.createdAt);
      for (const [teamId, teamWins] of [
        [100, match.blueWins],
        [200, !match.blueWins],
      ] as const) {
        for (const [i, role] of roles.entries()) {
          insertParticipant.run(
            match.matchId,
            `puuid-${match.matchId}-${teamId}-${i}`,
            teamId,
            i === 0 ? 100 : teamId * 10 + i,
            role,
            teamWins ? 1 : 0,
          );
        }
      }
    }
    db.close();

    await backtestCommand.run(['draft']);

    const report = JSON.parse(
      readFileSync(join(process.env.DRAFTORB_PUBLIC_DIR as string, 'backtest-draft.json'), 'utf8'),
    );
    expect(report.holdoutPatch).toBe('16.21');
    expect(report.matchup).not.toBeNull();
    expect(report.matchup.validationPatch).toBe('16.20');
    expect(report.matchup.candidates.map((c: { shrinkageK: unknown }) => c.shrinkageK)).toEqual([
      'off',
      0,
      25,
      50,
      100,
      200,
      400,
    ]);
    // Tiny synthetic data cannot pass the gate: matchups stay disabled.
    expect(report.matchup.enabled).toBe(false);
    expect(report.validationStatus).toBe('unvalidated');
    expect(report.matchup.roles).toEqual(report.roles);
  });

  it('pools the matchup experiment only over roles with scored holdout picks', async () => {
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.19', '16.20', '16.21']);
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
      ...Array.from({ length: 15 }, (_, i) => ({
        matchId: `q19-${i}`,
        patch: '16.19',
        createdAt: i + 1,
        blueWins: i % 2 === 0,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        matchId: `q20-${i}`,
        patch: '16.20',
        createdAt: 100 + i,
        blueWins: i % 2 === 0,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        matchId: `q21-${i}`,
        patch: '16.21',
        createdAt: 200 + i,
        blueWins: i % 2 === 0,
      })),
    ];
    let matchSeq = 0;
    for (const match of matches) {
      matchSeq += 1;
      insertMatch.run(match.matchId, match.patch, match.createdAt);
      for (const [teamId, teamWins] of [
        [100, match.blueWins],
        [200, !match.blueWins],
      ] as const) {
        for (const [i, role] of roles.entries()) {
          // MID picks a unique champion per match: never enough baseline
          // games to be scored, so it carries no matchup evidence.
          const championId =
            role === 'MID'
              ? 9000 + matchSeq * 2 + (teamId === 100 ? 0 : 1)
              : i === 0
                ? 100
                : teamId * 10 + i;
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
    db.close();

    await backtestCommand.run(['draft']);

    const report = JSON.parse(
      readFileSync(join(process.env.DRAFTORB_PUBLIC_DIR as string, 'backtest-draft.json'), 'utf8'),
    );
    expect(report.insufficientData).toBe(false);
    // MID picks were all baseline fallbacks: evaluated but not covered.
    expect(report.perRole.MID.predictions).toBeGreaterThan(0);
    expect(report.perRole.MID.unscored).toBe(report.perRole.MID.predictions);
    expect(report.roles).not.toContain('MID');
    expect(report.roles.length).toBeGreaterThan(0);
    expect(report.matchup).not.toBeNull();
    expect(report.matchup.roles).toEqual(report.roles);
    expect(report.matchup.roles).not.toContain('MID');

    // Tuning must not depend on holdout coverage: shrinking the gate role
    // set leaves the validation-patch candidate losses (and therefore the
    // selected variant) untouched.
    const check = openDb(dbPath);
    const rows = check
      .prepare(
        `SELECT
           m.match_id AS matchId, m.patch AS patch, p.team_id AS teamId,
           p.champion_id AS championId, p.role AS role, p.win AS win,
           m.avg_rank_score AS matchRankScore, p.puuid AS playerId
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id`,
      )
      .all() as DraftRow[];
    check.close();
    const engine = buildEngineData(dbPath, rows);
    const requested: Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
    const covered = runMatchupExperiment(dbPath, rows, engine, requested, report.roles as Role[]);
    const unfiltered = runMatchupExperiment(dbPath, rows, engine, requested, requested);
    expect(covered).not.toBeNull();
    expect(unfiltered).not.toBeNull();
    expect(covered?.candidates).toEqual(unfiltered?.candidates);
    expect(covered?.roles).toEqual(report.roles);
    expect(unfiltered?.roles).toContain('MID');
  });

  it('restricts evaluated roles through --roles', async () => {
    const db = openDb(dbPath);
    migrate(db);
    seed(db);
    db.close();

    await backtestCommand.run(['draft', '--roles=SUPPORT']);

    const report = JSON.parse(
      readFileSync(join(process.env.DRAFTORB_PUBLIC_DIR as string, 'backtest-draft.json'), 'utf8'),
    );
    expect(report.roles).toEqual(['SUPPORT']);
    expect(report.perRole.SUPPORT.predictions).toBe(10);
    expect(report.perRole.TOP.predictions).toBe(0);
  });

  it('rejects an unknown --roles value', async () => {
    await expect(backtestCommand.run(['draft', '--roles=SUPPORT,NOPE'])).rejects.toThrow(
      /Unknown role/,
    );
  });

  it('copies patches into the in-memory database without touching the live table', async () => {
    const db = openDb(dbPath);
    migrate(db);
    seed(db);
    const before = db
      .prepare('SELECT patch_index, version_label FROM patches ORDER BY patch_index')
      .all();
    db.close();

    await backtestCommand.run(['draft']);

    const after = openDb(dbPath);
    try {
      expect(
        after.prepare('SELECT patch_index, version_label FROM patches ORDER BY patch_index').all(),
      ).toEqual(before);
    } finally {
      after.close();
    }
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
