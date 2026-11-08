import { describe, expect, it } from 'vitest';

import {
  addBreakpoint,
  breakpointAppliesToPatch,
  combineBreakpointWeight,
  listBreakpoints,
  rejectBreakpoint,
  validateBreakpoint,
} from './breakpoints';
import { ETL_CONFIG } from './config/etl-config';
import { freshDb, insertBreakpoint, type Db } from './breakpoints.test-helpers';

describe('addBreakpoint / listBreakpoints', () => {
  it('inserts an active manual breakpoint and lists it with the patch label', () => {
    const db = freshDb();
    const row = addBreakpoint(db, {
      scopeType: 'champion',
      scopeId: 41,
      fromPatchIndex: 3, // '16.22' in the 3-label fixture catalog
      mode: 'downweight',
      weightFactor: 0.5,
      reason: 'hotfix broke Q damage',
      now: 1234,
    });
    expect(row).toMatchObject({
      scopeType: 'champion',
      scopeId: 41,
      fromPatchIndex: 3,
      mode: 'downweight',
      weightFactor: 0.5,
      status: 'active',
      source: 'manual',
      reason: 'hotfix broke Q damage',
      createdAt: 1234,
    });

    const listed = listBreakpoints(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: row.id, patchLabel: '16.22' });
    db.close();
  });

  it('rejects invalid specs before hitting SQLite', () => {
    const db = freshDb();
    const base = {
      fromPatchIndex: 22,
      mode: 'downweight' as const,
      weightFactor: 0.5,
      reason: 'r',
    };
    expect(() => addBreakpoint(db, { ...base, scopeType: 'champion' })).toThrow(
      /scopeId is required/,
    );
    expect(() => addBreakpoint(db, { ...base, scopeType: 'global', scopeId: 1 })).toThrow(
      /must be omitted/,
    );
    expect(() =>
      addBreakpoint(db, { ...base, scopeType: 'champion', scopeId: 1, fromPatchIndex: 0 }),
    ).toThrow(/>= 1/);
    expect(() =>
      addBreakpoint(db, {
        scopeType: 'champion',
        scopeId: 1,
        fromPatchIndex: 22,
        mode: 'reset',
        weightFactor: 0.5,
        reason: 'r',
      }),
    ).toThrow(/must be omitted/);
    expect(() =>
      addBreakpoint(db, {
        scopeType: 'champion',
        scopeId: 1,
        fromPatchIndex: 22,
        mode: 'downweight',
        reason: 'r',
      }),
    ).toThrow(/\(0, 1\]/);
    expect(() =>
      addBreakpoint(db, {
        scopeType: 'champion',
        scopeId: 1,
        fromPatchIndex: 22,
        mode: 'downweight',
        weightFactor: 0.5,
        reason: '   ',
      }),
    ).toThrow(/non-empty/);
    db.close();
  });

  it('rejects a duplicate manual breakpoint for the same scope/from_patch_index', () => {
    const db = freshDb();
    const spec = {
      scopeType: 'champion' as const,
      scopeId: 41,
      fromPatchIndex: 22,
      mode: 'downweight' as const,
      weightFactor: 0.5,
      reason: 'first',
    };
    addBreakpoint(db, spec);
    expect(() => addBreakpoint(db, { ...spec, reason: 'second' })).toThrow(/already exists/);
    db.close();
  });
});

function insertSuggested(db: Db): number {
  const result = db
    .prepare(
      `INSERT INTO data_breakpoints (
        scope_type, scope_id, from_patch_index, mode, weight_factor,
        status, source, reason, created_at
      ) VALUES ('champion', 41, 22, 'downweight', 0.5, 'suggested', 'auto', 'auto', 1)`,
    )
    .run();
  return Number(result.lastInsertRowid);
}

describe('breakpoint lifecycle (validate/reject)', () => {
  it('transitions suggested -> active via validate', () => {
    const db = freshDb();
    const id = insertSuggested(db);
    const row = validateBreakpoint(db, id);
    expect(row.status).toBe('active');
    db.close();
  });

  it('transitions suggested -> rejected via reject', () => {
    const db = freshDb();
    const id = insertSuggested(db);
    const row = rejectBreakpoint(db, id);
    expect(row.status).toBe('rejected');
    db.close();
  });

  it('rejects transitions from non-suggested statuses and unknown ids', () => {
    const db = freshDb();
    insertBreakpoint(db, {
      status: 'active',
      source: 'manual',
      from_patch_index: 21,
      mode: 'reset',
      weight_factor: null,
    });
    const active = db.prepare("SELECT id FROM data_breakpoints WHERE status = 'active'").get() as {
      id: number;
    };
    const activeId = active.id;
    expect(() => validateBreakpoint(db, activeId)).toThrow(/only 'suggested'/);
    expect(() => rejectBreakpoint(db, activeId)).toThrow(/only 'suggested'/);
    const suggestedId = insertSuggested(db);
    rejectBreakpoint(db, suggestedId);
    expect(() => validateBreakpoint(db, suggestedId)).toThrow(/only 'suggested'/);
    expect(() => rejectBreakpoint(db, 9999)).toThrow(/not found/);
    db.close();
  });
});

describe('breakpointAppliesToPatch / combineBreakpointWeight', () => {
  it('affects only patch_index strictly below from_patch_index', () => {
    // Hotfix limitation (SPECS §16): data from the same patch_index —
    // including hotfixes merged into it — is never affected.
    expect(breakpointAppliesToPatch(22, 21)).toBe(true);
    expect(breakpointAppliesToPatch(22, 1)).toBe(true);
    expect(breakpointAppliesToPatch(22, 22)).toBe(false);
    expect(breakpointAppliesToPatch(22, 23)).toBe(false);
    // A breakpoint on a pruned patch still applies to whatever retained
    // data has patch_index < from_patch_index (SPECS §16).
    expect(breakpointAppliesToPatch(5, 4)).toBe(true);
    expect(breakpointAppliesToPatch(5, 5)).toBe(false);
  });

  it('reset dominates over downweight factors', () => {
    expect(
      combineBreakpointWeight([
        { mode: 'downweight', weightFactor: 0.5 },
        { mode: 'reset', weightFactor: null },
        { mode: 'downweight', weightFactor: 0.5 },
      ]),
    ).toBe(0);
  });

  it('multiplies downweight factors and floors at minWeight', () => {
    expect(
      combineBreakpointWeight([
        { mode: 'downweight', weightFactor: 0.5 },
        { mode: 'downweight', weightFactor: 0.5 },
      ]),
    ).toBe(0.25);
    // 0.2 * 0.2 = 0.04 < minWeight 0.05 -> floored.
    expect(
      combineBreakpointWeight([
        { mode: 'downweight', weightFactor: 0.2 },
        { mode: 'downweight', weightFactor: 0.2 },
      ]),
    ).toBe(ETL_CONFIG.minWeight);
    expect(combineBreakpointWeight([{ mode: 'downweight', weightFactor: 0.5 }])).toBe(0.5);
  });

  it('is neutral (1) for an empty set and honors a custom minWeight', () => {
    expect(combineBreakpointWeight([])).toBe(1);
    expect(
      combineBreakpointWeight(
        [
          { mode: 'downweight', weightFactor: 0.1 },
          { mode: 'downweight', weightFactor: 0.1 },
        ],
        0.5,
      ),
    ).toBe(0.5);
  });
});
