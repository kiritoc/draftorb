import { migrate, openDb } from './db';
import { seedPatches } from './patches.test-helpers';

export type Db = ReturnType<typeof openDb>;

/** In-memory DB migrated through the latest migration with 3 fixture patches. */
export function freshDb(): Db {
  const db = openDb(':memory:');
  migrate(db);
  seedPatches(db, ['16.20', '16.21', '16.22']);
  return db;
}

/** A valid data_breakpoints row; tests override one field to break a CHECK. */
export function validBreakpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scope_type: 'champion',
    scope_id: 41,
    from_patch_index: 22,
    mode: 'downweight',
    weight_factor: 0.5,
    status: 'active',
    source: 'manual',
    reason: 'test reason',
    created_at: 1000,
    ...overrides,
  };
}

export function insertBreakpoint(db: Db, overrides: Record<string, unknown> = {}): void {
  const row = validBreakpoint(overrides);
  db.prepare(
    `INSERT INTO data_breakpoints (
      scope_type, scope_id, from_patch_index, mode, weight_factor,
      status, source, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.scope_type,
    row.scope_id,
    row.from_patch_index,
    row.mode,
    row.weight_factor,
    row.status,
    row.source,
    row.reason,
    row.created_at,
  );
}

export function insertChangeScore(db: Db, overrides: Record<string, unknown> = {}): void {
  const row = {
    entity_type: 'champion',
    entity_id: 41,
    patch_index: 22,
    content_hash: 'abc123',
    change_score: 0.4,
    details: '[]',
    ...overrides,
  };
  db.prepare(
    `INSERT INTO entity_change_scores (
      entity_type, entity_id, patch_index, content_hash, change_score, details
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    row.entity_type,
    row.entity_id,
    row.patch_index,
    row.content_hash,
    row.change_score,
    row.details,
  );
}
