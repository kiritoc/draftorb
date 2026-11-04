import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrate, openDb } from './db';
import {
  accumulateWeighted,
  assertPatchFormat,
  gameBucketIndex,
  groupRowsByMatch,
  loadPatchWindow,
  partitionByTeam,
} from './aggregate-shared';

function seedMatch(db: ReturnType<typeof openDb>, matchId: string, patch: string): void {
  db.prepare(
    `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score)
     VALUES (?, 'euw1', ?, 420, 1800, 1, 6.5)`,
  ).run(matchId, patch);
}

describe('assertPatchFormat', () => {
  it('accepts undefined and valid patches, rejects malformed ones', () => {
    expect(() => assertPatchFormat(undefined)).not.toThrow();
    expect(() => assertPatchFormat('16.21')).not.toThrow();
    expect(() => assertPatchFormat('16')).toThrow(
      'Invalid patch "16". Expected a format like "16.21".',
    );
  });
});

describe('loadPatchWindow', () => {
  let directory: string;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-shared-'));
    db = openDb(join(directory, 'test.sqlite'));
    migrate(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns an empty window on an empty database', () => {
    const window = loadPatchWindow(db);
    expect(window.patches).toEqual([]);
    expect(window.patchIndex.size).toBe(0);
    expect(window.currentPatchIndex).toBe(-1);
  });

  it('builds a dense index over distinct stored patches, sorted numerically', () => {
    seedMatch(db, 'm2', '16.10');
    seedMatch(db, 'm1', '16.9');
    const window = loadPatchWindow(db);
    expect(window.patches).toEqual(['16.9', '16.10']);
    expect(window.patchIndex.get('16.9')).toBe(0);
    expect(window.patchIndex.get('16.10')).toBe(1);
    expect(window.currentPatchIndex).toBe(1);
  });

  it('compares patches numerically ("16.10" > "16.9", not string order)', () => {
    seedMatch(db, 'm1', '16.9');
    seedMatch(db, 'm2', '16.10');
    const window = loadPatchWindow(db);
    expect(window.patches.indexOf('16.10')).toBeGreaterThan(window.patches.indexOf('16.9'));
  });

  it('filters stored patches newer than the snapshot and adds the snapshot', () => {
    seedMatch(db, 'm1', '16.20');
    seedMatch(db, 'm2', '16.21');
    const window = loadPatchWindow(db, '16.20');
    expect(window.patches).toEqual(['16.20']);
    expect(window.patchIndex.get('16.21')).toBeUndefined();
  });

  it('adds the snapshot patch even when no stored patch carries it', () => {
    seedMatch(db, 'm1', '16.20');
    const window = loadPatchWindow(db, '16.21');
    expect(window.patches).toEqual(['16.20', '16.21']);
    expect(window.patchIndex.get('16.21')).toBe(1);
  });

  it('does not add the snapshot when no stored patch qualifies', () => {
    seedMatch(db, 'm1', '16.21');
    const window = loadPatchWindow(db, '16.20');
    expect(window.patches).toEqual([]);
    expect(window.currentPatchIndex).toBe(-1);
  });
});

describe('gameBucketIndex', () => {
  it('clamps to [0, last bucket]', () => {
    expect(gameBucketIndex(-1)).toBe(0);
    expect(gameBucketIndex(6.5)).toBe(6); // DIAMOND
    expect(gameBucketIndex(6.9)).toBe(6);
    expect(gameBucketIndex(42)).toBe(7); // MASTER_PLUS
  });
});

describe('accumulateWeighted', () => {
  it('creates the row once, then adds weighted counts', () => {
    const map = new Map<
      string,
      { winsW: number; gamesW: number; gamesW2: number; games: number }
    >();
    const create = () => ({ winsW: 0, gamesW: 0, gamesW2: 0, games: 0 });
    accumulateWeighted(map, 'k', 0.5, 1, create).games += 1;
    accumulateWeighted(map, 'k', 0.25, 0, create).games += 1;
    expect(map.get('k')).toEqual({ winsW: 0.5, gamesW: 0.75, gamesW2: 0.3125, games: 2 });
  });
});

describe('groupRowsByMatch', () => {
  it('yields consecutive rows sharing a matchId', () => {
    const rows = [
      { matchId: 'a', v: 1 },
      { matchId: 'a', v: 2 },
      { matchId: 'b', v: 3 },
      { matchId: 'c', v: 4 },
      { matchId: 'c', v: 5 },
      { matchId: 'c', v: 6 },
    ];
    const groups = [...groupRowsByMatch(rows)];
    expect(groups.map((g) => g.map((r) => r.v))).toEqual([[1, 2], [3], [4, 5, 6]]);
  });

  it('yields nothing for empty input', () => {
    expect([...groupRowsByMatch([])]).toEqual([]);
  });
});

describe('partitionByTeam', () => {
  it('groups by teamId preserving input order', () => {
    const teams = partitionByTeam([
      { teamId: 100, n: 'a' },
      { teamId: 200, n: 'b' },
      { teamId: 100, n: 'c' },
    ]);
    expect(teams.get(100)?.map((p) => p.n)).toEqual(['a', 'c']);
    expect(teams.get(200)?.map((p) => p.n)).toEqual(['b']);
  });
});
