import { describe, expect, it } from 'vitest';

import { freshDb, insertBreakpoint, insertChangeScore } from './breakpoints.test-helpers';

/**
 * DDL constraint tests for migration 016 (T-019.e): one failing insert per
 * CHECK constraint of both new tables, the NULL scope_id uniqueness case and
 * the entity_change_scores bounds/primary key.
 */
describe('entity_change_scores constraints (T-019.e)', () => {
  it('accepts valid rows including NULL and boundary change_score', () => {
    const db = freshDb();
    insertChangeScore(db);
    insertChangeScore(db, { entity_id: 42, change_score: null });
    insertChangeScore(db, { entity_id: 43, change_score: 0 });
    insertChangeScore(db, { entity_id: 44, change_score: 1, entity_type: 'item' });
    insertChangeScore(db, { entity_id: 45, entity_type: 'rune' });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM entity_change_scores').get() as { n: number },
    ).toMatchObject({ n: 5 });
    db.close();
  });

  it('rejects an unknown entity_type', () => {
    const db = freshDb();
    expect(() => insertChangeScore(db, { entity_type: 'summoner' })).toThrow(/CHECK/i);
    db.close();
  });

  it('rejects change_score outside [0, 1]', () => {
    const db = freshDb();
    expect(() => insertChangeScore(db, { change_score: -0.01 })).toThrow(/CHECK/i);
    expect(() => insertChangeScore(db, { change_score: 1.01 })).toThrow(/CHECK/i);
    db.close();
  });

  it('rejects a duplicate (entity_type, entity_id, patch_index) primary key', () => {
    const db = freshDb();
    insertChangeScore(db);
    expect(() => insertChangeScore(db, { content_hash: 'different' })).toThrow(/UNIQUE/i);
    db.close();
  });
});

describe('data_breakpoints constraints (T-019.e)', () => {
  it('accepts a valid row of every scope/mode combination', () => {
    const db = freshDb();
    insertBreakpoint(db); // champion downweight
    insertBreakpoint(db, {
      scope_type: 'item',
      scope_id: 3089,
      from_patch_index: 21,
      mode: 'reset',
      weight_factor: null,
    });
    insertBreakpoint(db, {
      scope_type: 'rune',
      scope_id: 8005,
      from_patch_index: 20,
      mode: 'reset',
      weight_factor: null,
      source: 'auto',
      status: 'suggested',
    });
    insertBreakpoint(db, {
      scope_type: 'global',
      scope_id: null,
      from_patch_index: 22,
      mode: 'downweight',
      weight_factor: 1,
    });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM data_breakpoints').get() as { n: number },
    ).toMatchObject({ n: 4 });
    db.close();
  });

  it('rejects an unknown scope_type', () => {
    const db = freshDb();
    expect(() => insertBreakpoint(db, { scope_type: 'team' })).toThrow(/CHECK/i);
    db.close();
  });

  it('rejects from_patch_index < 1', () => {
    const db = freshDb();
    expect(() => insertBreakpoint(db, { from_patch_index: 0 })).toThrow(/CHECK/i);
    expect(() => insertBreakpoint(db, { from_patch_index: -3 })).toThrow(/CHECK/i);
    db.close();
  });

  it('rejects an unknown mode', () => {
    const db = freshDb();
    expect(() => insertBreakpoint(db, { mode: 'halve' })).toThrow(/CHECK/i);
    db.close();
  });

  it('rejects reset with a weight_factor and downweight without a valid one', () => {
    const db = freshDb();
    // mode/weight_factor CHECK: reset must have NULL factor.
    expect(() => insertBreakpoint(db, { mode: 'reset', weight_factor: 0.5 })).toThrow(/CHECK/i);
    // downweight must have a factor in (0, 1].
    expect(() => insertBreakpoint(db, { mode: 'downweight', weight_factor: null })).toThrow(
      /CHECK/i,
    );
    expect(() => insertBreakpoint(db, { mode: 'downweight', weight_factor: 0 })).toThrow(/CHECK/i);
    expect(() => insertBreakpoint(db, { mode: 'downweight', weight_factor: 1.5 })).toThrow(
      /CHECK/i,
    );
    db.close();
  });

  it('rejects an unknown status or source', () => {
    const db = freshDb();
    expect(() => insertBreakpoint(db, { status: 'pending' })).toThrow(/CHECK/i);
    expect(() => insertBreakpoint(db, { source: 'cron' })).toThrow(/CHECK/i);
    db.close();
  });

  it('rejects an empty reason', () => {
    const db = freshDb();
    expect(() => insertBreakpoint(db, { reason: '' })).toThrow(/CHECK/i);
    db.close();
  });

  it('enforces scope_id NULL iff scope_type is global', () => {
    const db = freshDb();
    // Non-global scope without scope_id.
    expect(() => insertBreakpoint(db, { scope_id: null })).toThrow(/CHECK/i);
    // Global scope with a scope_id.
    expect(() =>
      insertBreakpoint(db, { scope_type: 'global', scope_id: 41, weight_factor: 0.5 }),
    ).toThrow(/CHECK/i);
    db.close();
  });

  it('enforces uniqueness per (scope, from_patch_index, source), NULL scope_id included', () => {
    const db = freshDb();
    insertBreakpoint(db);
    // Same scope/from/source collides.
    expect(() => insertBreakpoint(db, { reason: 'duplicate' })).toThrow(/UNIQUE/i);
    // A different source does not collide.
    insertBreakpoint(db, { source: 'auto', status: 'suggested' });
    // A different from_patch_index does not collide.
    insertBreakpoint(db, { from_patch_index: 21 });
    // Two global rows share the NULL scope_id through COALESCE(scope_id, -1).
    insertBreakpoint(db, {
      scope_type: 'global',
      scope_id: null,
      mode: 'reset',
      weight_factor: null,
    });
    expect(() =>
      insertBreakpoint(db, {
        scope_type: 'global',
        scope_id: null,
        mode: 'reset',
        weight_factor: null,
        reason: 'duplicate global',
      }),
    ).toThrow(/UNIQUE/i);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM data_breakpoints').get() as { n: number },
    ).toMatchObject({ n: 4 });
    db.close();
  });
});
