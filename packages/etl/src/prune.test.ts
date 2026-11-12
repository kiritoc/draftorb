import { describe, expect, it } from 'vitest';

import { ETL_CONFIG } from './config/etl-config';
import { migrate, openDb } from './db';
import { seedPatches } from './patches.test-helpers';
import { pruneMatches } from './prune';

/** 30 contiguous fixture patches: index i+1 holds label `16.<i+1>`. */
const PATCH_LABELS = Array.from({ length: 30 }, (_, i) => `16.${i + 1}`);

function insertMatch(db: ReturnType<typeof openDb>, matchId: string, patch: string): void {
  db.prepare(
    `INSERT INTO matches (
      match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
    ) VALUES (?, 'euw1', ?, 420, 1800, 1, 6.5, 1)`,
  ).run(matchId, patch);
}

function insertParticipant(db: ReturnType<typeof openDb>, matchId: string): void {
  db.prepare(
    `INSERT INTO participants (
      match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
      mastery_points, is_expert, keystone, primary_style, sub_style, perks_json,
      items_json, kills, deaths, assists
    ) VALUES (?, 'p-1', 100, 412, 'SUPPORT', 1, 6.5, 0, NULL, NULL, 8000, 8100, 8200, '{}', '[]', 1, 2, 5)`,
  ).run(matchId);
}

function insertItemEvent(db: ReturnType<typeof openDb>, matchId: string): void {
  db.prepare(
    `INSERT INTO item_events (
      match_id, participant_id, puuid, ts_ms, seq, event_type, item_id,
      before_id, after_id, team_gold_diff, kills_diff
    ) VALUES (?, 1, 'p-1', 1000, 0, 'purchase', 3109, NULL, NULL, 0, 0)`,
  ).run(matchId);
}

function matchIds(db: ReturnType<typeof openDb>): string[] {
  return (
    db.prepare('SELECT match_id FROM matches ORDER BY match_id').all() as {
      match_id: string;
    }[]
  ).map((row) => row.match_id);
}

describe('pruneMatches', () => {
  it('deletes matches at and below the cutoff, cascades, and writes pruned tombstones', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPatches(db, PATCH_LABELS);
    // cutoff = 30 - 20 = 10: '16.10' (index 10) is pruned, '16.11' (index 11) kept.
    insertMatch(db, 'EUW1_EDGE_KEPT', '16.11');
    insertMatch(db, 'EUW1_KEPT', '16.30');
    insertMatch(db, 'EUW1_PRUNED', '16.10');
    insertParticipant(db, 'EUW1_PRUNED');
    insertItemEvent(db, 'EUW1_PRUNED');
    insertMatch(db, 'EUW1_UNKNOWN', '15.1'); // label absent from patches: kept

    const result = pruneMatches(db);

    expect(result).toMatchObject({
      dryRun: false,
      keepPatches: ETL_CONFIG.retentionPatches,
      latestPatchIndex: 30,
      cutoffPatchIndex: 10,
      candidates: 1,
      skippedUnknownPatch: 1,
      matchesPruned: 1,
      tombstonesWritten: 1,
    });
    expect(matchIds(db)).toEqual(['EUW1_EDGE_KEPT', 'EUW1_KEPT', 'EUW1_UNKNOWN']);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM participants').get() as { n: number },
    ).toMatchObject({ n: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM item_events').get() as { n: number },
    ).toMatchObject({ n: 0 });
    const tombstone = db
      .prepare('SELECT reason, patch FROM match_rejects WHERE match_id = ?')
      .get('EUW1_PRUNED') as { reason: string; patch: string };
    expect(tombstone).toEqual({ reason: 'pruned', patch: '16.10' });
    db.close();
  });

  it('is idempotent: a second run finds nothing to prune', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPatches(db, PATCH_LABELS);
    insertMatch(db, 'EUW1_PRUNED', '16.1');
    insertMatch(db, 'EUW1_KEPT', '16.30');

    const first = pruneMatches(db);
    const second = pruneMatches(db);

    expect(first.matchesPruned).toBe(1);
    expect(second).toMatchObject({ candidates: 0, matchesPruned: 0, tombstonesWritten: 0 });
    expect(matchIds(db)).toEqual(['EUW1_KEPT']);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM match_rejects').get() as { n: number },
    ).toMatchObject({ n: 1 });
    db.close();
  });

  it('dry-run reports counts without deleting matches or writing tombstones', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPatches(db, PATCH_LABELS);
    insertMatch(db, 'EUW1_PRUNED', '16.5');
    insertMatch(db, 'EUW1_KEPT', '16.30');

    const result = pruneMatches(db, { dryRun: true });

    expect(result).toMatchObject({ dryRun: true, candidates: 1, matchesPruned: 0 });
    expect(matchIds(db)).toEqual(['EUW1_KEPT', 'EUW1_PRUNED']);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM match_rejects').get() as { n: number },
    ).toMatchObject({ n: 0 });
    db.close();
  });

  it('honors an explicit --keep-patches smaller than the default (manual cut)', () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPatches(db, PATCH_LABELS);
    insertMatch(db, 'EUW1_MID', '16.15'); // index 15: inside default window, outside keep=5
    insertMatch(db, 'EUW1_KEPT', '16.30');

    const result = pruneMatches(db, { keepPatches: 5 });

    expect(result).toMatchObject({ keepPatches: 5, cutoffPatchIndex: 25, matchesPruned: 1 });
    expect(matchIds(db)).toEqual(['EUW1_KEPT']);
    db.close();
  });

  it('keeps every match when the patches table is empty', () => {
    const db = openDb(':memory:');
    migrate(db);
    insertMatch(db, 'EUW1_ANY', '16.1');

    const result = pruneMatches(db);

    expect(result).toMatchObject({
      latestPatchIndex: null,
      cutoffPatchIndex: null,
      candidates: 0,
      matchesPruned: 0,
    });
    expect(matchIds(db)).toEqual(['EUW1_ANY']);
    db.close();
  });
});
