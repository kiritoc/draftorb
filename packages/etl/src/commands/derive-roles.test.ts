import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from '../db';
import { seedPatches } from '../patches.test-helpers';
import { UsageError } from '../cli-args';
import { deriveRolesCommand } from './derive-roles';

describe('deriveRolesCommand', () => {
  let directory: string;
  let originalDbPath: string | undefined;
  let originalPublicDir: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-derive-roles-'));
    originalDbPath = process.env.DRAFTORB_DB_PATH;
    originalPublicDir = process.env.DRAFTORB_PUBLIC_DIR;
    process.env.DRAFTORB_DB_PATH = join(directory, 'test.sqlite');
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

  const output = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

  let seq = 0;
  const addParticipant = (
    db: ReturnType<typeof openDb>,
    matchId: string,
    championId: number,
    role: string,
  ): void => {
    seq += 1;
    db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
        keystone, primary_style, sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (?, ?, 100, ?, ?, 1, 6.5, 0, 8439, 8400, 8300, '{}', '[]', 0, 0, 0)`,
    ).run(matchId, `puuid-${seq}`, championId, role);
  };

  it('prints a message and returns when the database is missing', async () => {
    await expect(deriveRolesCommand.run([])).resolves.toBeUndefined();
    expect(output()).toMatch(/no database at/);
  });

  it('rejects a malformed patch with a usage error', async () => {
    await expect(deriveRolesCommand.run(['16'])).rejects.toBeInstanceOf(UsageError);
  });

  it('rejects too many arguments with a usage error', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    db.close();
    await expect(deriveRolesCommand.run(['16.21', 'extra'])).rejects.toBeInstanceOf(UsageError);
  });

  it('rewrites champions.json.roles from role-prob data and keeps bootstrap roles for unobserved champions', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.21']);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score) VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    addParticipant(db, 'm1', 412, 'SUPPORT');
    addParticipant(db, 'm1', 267, 'MID');
    addParticipant(db, 'm1', 267, 'SUPPORT');
    db.close();

    const patchDir = join(directory, 'public', '16.21');
    await fs.mkdir(patchDir, { recursive: true });
    await fs.writeFile(
      join(patchDir, 'champions.json'),
      JSON.stringify({
        '412': { id: 412, name: 'Thresh', icon: 'Thresh.png', roles: ['SUPPORT', 'TOP'] },
        '267': { id: 267, name: 'Nami', icon: 'Nami.png', roles: ['SUPPORT', 'MID'] },
        '99': { id: 99, name: 'Flex', icon: 'Flex.png', roles: ['MID'] },
      }),
      'utf-8',
    );
    await fs.writeFile(join(patchDir, 'manifest.json'), '{"files":[]}', 'utf8');

    await deriveRolesCommand.run([]);

    const written = JSON.parse(await fs.readFile(join(patchDir, 'champions.json'), 'utf-8'));
    expect(written['412'].roles).toEqual(['SUPPORT']);
    expect(written['267'].roles).toEqual(['MID', 'SUPPORT']);
    expect(written['99'].roles).toEqual(['MID']);
    await expect(fs.readFile(join(patchDir, 'manifest.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const bootstrap = JSON.parse(
      await fs.readFile(join(patchDir, 'champions.bootstrap.json'), 'utf8'),
    );
    expect(bootstrap['412'].roles).toEqual(['SUPPORT', 'TOP']);
    expect(await fs.readFile(join(patchDir, 'champions.derived.json'), 'utf8')).toBe(
      await fs.readFile(join(patchDir, 'champions.json'), 'utf8'),
    );
    expect(output()).toMatch(/Derived champion roles/);
  });

  it('leaves roles unchanged when role_prob is empty', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.21']);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score) VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    db.close();

    const patchDir = join(directory, 'public', '16.21');
    await fs.mkdir(patchDir, { recursive: true });
    await fs.writeFile(
      join(patchDir, 'champions.json'),
      JSON.stringify({
        '412': { id: 412, name: 'Thresh', icon: 'Thresh.png', roles: ['SUPPORT', 'TOP'] },
      }),
      'utf-8',
    );

    await deriveRolesCommand.run([]);

    const written = JSON.parse(await fs.readFile(join(patchDir, 'champions.json'), 'utf-8'));
    expect(written['412'].roles).toEqual(['SUPPORT', 'TOP']);
  });

  it('prints a message and returns when champions.json is missing', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.21']);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score) VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    db.close();

    await deriveRolesCommand.run([]);
    expect(output()).toMatch(/no champions.json at/);
  });

  it('uses an explicit patch argument for the champions file', async () => {
    const dbPath = join(directory, 'test.sqlite');
    process.env.DRAFTORB_DB_PATH = dbPath;
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.20', '16.21']);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score) VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score) VALUES ('m0', 'euw1', '16.20', 420, 1800, 1, 6.5)`,
    ).run();
    addParticipant(db, 'm0', 412, 'SUPPORT');
    // Newer patch data must not leak into the 16.20 catalog.
    addParticipant(db, 'm1', 412, 'TOP');
    db.close();

    const patchDir = join(directory, 'public', '16.20');
    await fs.mkdir(patchDir, { recursive: true });
    await fs.writeFile(
      join(patchDir, 'champions.json'),
      JSON.stringify({ '412': { id: 412, name: 'Thresh', icon: 'Thresh.png', roles: ['TOP'] } }),
      'utf-8',
    );

    await deriveRolesCommand.run(['16.20']);
    const written = JSON.parse(await fs.readFile(join(patchDir, 'champions.json'), 'utf-8'));
    expect(written['412'].roles).toEqual(['SUPPORT']);
  });

  it('restores bootstrap roles when a champion is no longer observed', async () => {
    const dbPath = join(directory, 'test.sqlite');
    const db = openDb(dbPath);
    migrate(db);
    seedPatches(db, ['16.21']);
    db.prepare(
      `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score) VALUES ('m1', 'euw1', '16.21', 420, 1800, 1, 6.5)`,
    ).run();
    addParticipant(db, 'm1', 412, 'SUPPORT');
    db.close();

    const patchDir = join(directory, 'public', '16.21');
    await fs.mkdir(patchDir, { recursive: true });
    await fs.writeFile(
      join(patchDir, 'champions.json'),
      JSON.stringify({
        '412': { id: 412, name: 'Thresh', icon: 'Thresh.png', roles: ['SUPPORT', 'TOP'] },
      }),
      'utf-8',
    );
    await deriveRolesCommand.run([]);

    const db2 = openDb(dbPath);
    db2.prepare(`DELETE FROM participants`).run();
    db2.close();
    await deriveRolesCommand.run([]);

    const written = JSON.parse(await fs.readFile(join(patchDir, 'champions.json'), 'utf-8'));
    expect(written['412'].roles).toEqual(['SUPPORT', 'TOP']);
  });
});
