/**
 * @draftorb/etl — Data breakpoints and change scores (SPECS §14..§16,
 * D-045..D-047; DDL in migration 016 / DATA_MODEL.md §5.4).
 *
 * A breakpoint marks entity data before `from_patch_index` as suspect after a
 * balance patch: `reset` zeroes the change weight, `downweight` multiplies it
 * by `weight_factor`. Only `active` rows apply at aggregation (T-019.f);
 * `suggested` rows wait for review via `breakpoint validate|reject`.
 *
 * Combination rule (SPECS §16): among the active breakpoints covering a data
 * patch, `reset` dominates (weight 0); otherwise the `weight_factor`s
 * multiply, floored at `minWeight`. The same rule applies whether or not the
 * breakpoints share `from_patch_index`.
 */

import type Database from 'better-sqlite3';

import { ETL_CONFIG } from './config/etl-config';

export type BreakpointScopeType = 'champion' | 'item' | 'rune' | 'global';
export type BreakpointMode = 'reset' | 'downweight';
export type BreakpointStatus = 'suggested' | 'active' | 'rejected';
export type BreakpointSource = 'auto' | 'manual';

export const BREAKPOINT_SCOPE_TYPES: readonly BreakpointScopeType[] = [
  'champion',
  'item',
  'rune',
  'global',
];
export const BREAKPOINT_MODES: readonly BreakpointMode[] = ['reset', 'downweight'];
export const BREAKPOINT_STATUSES: readonly BreakpointStatus[] = ['suggested', 'active', 'rejected'];

export interface DataBreakpoint {
  id: number;
  scopeType: BreakpointScopeType;
  /** NULL iff scopeType is 'global'. */
  scopeId: number | null;
  fromPatchIndex: number;
  mode: BreakpointMode;
  /** NULL for 'reset'; in (0, 1] for 'downweight'. */
  weightFactor: number | null;
  status: BreakpointStatus;
  source: BreakpointSource;
  reason: string;
  createdAt: number;
}

interface BreakpointRow {
  id: number;
  scope_type: string;
  scope_id: number | null;
  from_patch_index: number;
  mode: string;
  weight_factor: number | null;
  status: string;
  source: string;
  reason: string;
  created_at: number;
  patch_label: string | null;
}

function toBreakpoint(row: BreakpointRow): DataBreakpoint {
  return {
    id: row.id,
    scopeType: row.scope_type as BreakpointScopeType,
    scopeId: row.scope_id,
    fromPatchIndex: row.from_patch_index,
    mode: row.mode as BreakpointMode,
    weightFactor: row.weight_factor,
    status: row.status as BreakpointStatus,
    source: row.source as BreakpointSource,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

/** Lists breakpoints, optionally filtered by status, with the patch label. */
export function listBreakpoints(
  db: Database.Database,
  status?: BreakpointStatus,
): Array<DataBreakpoint & { patchLabel: string | null }> {
  const where = status !== undefined ? 'WHERE b.status = ?' : '';
  const rows = db
    .prepare(
      `SELECT b.*, p.version_label AS patch_label
       FROM data_breakpoints b
       LEFT JOIN patches p ON p.patch_index = b.from_patch_index
       ${where}
       ORDER BY b.from_patch_index, b.scope_type, b.scope_id, b.id`,
    )
    .all(...(status !== undefined ? [status] : [])) as BreakpointRow[];
  return rows.map((row) => ({ ...toBreakpoint(row), patchLabel: row.patch_label }));
}

export interface AddBreakpointSpec {
  scopeType: BreakpointScopeType;
  /** Required for champion/item/rune scopes, must be omitted for 'global'. */
  scopeId?: number;
  fromPatchIndex: number;
  mode: BreakpointMode;
  /** Required for 'downweight' (0 < f <= 1), must be omitted for 'reset'. */
  weightFactor?: number;
  /** Mandatory human reason (CHECK length(reason) > 0). */
  reason: string;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
}

/**
 * Inserts a manual breakpoint as `active`/`source='manual'` (SPECS §16).
 * Validates the CHECK-level invariants up front so callers get a clear
 * message instead of a SQLite error; the table CHECKs remain the backstop.
 */
export function addBreakpoint(db: Database.Database, spec: AddBreakpointSpec): DataBreakpoint {
  const scopeId = spec.scopeType === 'global' ? null : (spec.scopeId ?? null);
  if (spec.scopeType !== 'global' && scopeId === null) {
    throw new Error(`scopeId is required for scope_type '${spec.scopeType}'.`);
  }
  if (spec.scopeType === 'global' && spec.scopeId !== undefined) {
    throw new Error("scopeId must be omitted for scope_type 'global'.");
  }
  if (!Number.isInteger(spec.fromPatchIndex) || spec.fromPatchIndex < 1) {
    throw new Error('fromPatchIndex must be an integer >= 1.');
  }
  if (spec.mode === 'reset' && spec.weightFactor !== undefined) {
    throw new Error("weightFactor must be omitted for mode 'reset'.");
  }
  if (spec.mode === 'downweight') {
    const f = spec.weightFactor;
    if (f === undefined || !(f > 0 && f <= 1)) {
      throw new Error("weightFactor must be in (0, 1] for mode 'downweight'.");
    }
  }
  if (spec.reason.trim().length === 0) {
    throw new Error('reason must be a non-empty string.');
  }

  const duplicate = db
    .prepare(
      `SELECT id FROM data_breakpoints
       WHERE scope_type = ? AND COALESCE(scope_id, -1) = COALESCE(?, -1)
         AND from_patch_index = ? AND source = 'manual'`,
    )
    .get(spec.scopeType, scopeId, spec.fromPatchIndex) as { id: number } | undefined;
  if (duplicate !== undefined) {
    throw new Error(
      `A manual breakpoint already exists for ${spec.scopeType}` +
        `${scopeId === null ? '' : ` ${scopeId}`} from patch_index ${spec.fromPatchIndex}.`,
    );
  }

  const result = db
    .prepare(
      `INSERT INTO data_breakpoints (
        scope_type, scope_id, from_patch_index, mode, weight_factor,
        status, source, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, 'active', 'manual', ?, ?)`,
    )
    .run(
      spec.scopeType,
      scopeId,
      spec.fromPatchIndex,
      spec.mode,
      spec.mode === 'downweight' ? (spec.weightFactor ?? null) : null,
      spec.reason,
      spec.now ?? Date.now(),
    );
  const row = db
    .prepare('SELECT * FROM data_breakpoints WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as BreakpointRow;
  return toBreakpoint(row);
}

function getBreakpoint(db: Database.Database, id: number): DataBreakpoint {
  const row = db.prepare('SELECT * FROM data_breakpoints WHERE id = ?').get(id) as
    BreakpointRow | undefined;
  if (row === undefined) {
    throw new Error(`Breakpoint #${id} not found.`);
  }
  return toBreakpoint(row);
}

/**
 * Lifecycle transition `suggested -> active` (SPECS §16 `breakpoint
 * validate`). Only suggested rows can transition; anything else is an error.
 */
export function validateBreakpoint(db: Database.Database, id: number): DataBreakpoint {
  const row = getBreakpoint(db, id);
  if (row.status !== 'suggested') {
    throw new Error(
      `Breakpoint #${id} is '${row.status}'; only 'suggested' breakpoints can be validated.`,
    );
  }
  db.prepare("UPDATE data_breakpoints SET status = 'active' WHERE id = ?").run(id);
  return getBreakpoint(db, id);
}

/** Lifecycle transition `suggested -> rejected` (SPECS §16 `breakpoint reject`). */
export function rejectBreakpoint(db: Database.Database, id: number): DataBreakpoint {
  const row = getBreakpoint(db, id);
  if (row.status !== 'suggested') {
    throw new Error(
      `Breakpoint #${id} is '${row.status}'; only 'suggested' breakpoints can be rejected.`,
    );
  }
  db.prepare("UPDATE data_breakpoints SET status = 'rejected' WHERE id = ?").run(id);
  return getBreakpoint(db, id);
}

/**
 * Whether a breakpoint covers data from `dataPatchIndex`: only patches BEFORE
 * `from_patch_index` are affected (SPECS §16). Data from the same patch —
 * including hotfixes merged into it — is never downweighted (known
 * limitation), and a breakpoint whose `from_patch_index` leaves no retained
 * data simply has no effect.
 */
export function breakpointAppliesToPatch(fromPatchIndex: number, dataPatchIndex: number): boolean {
  return dataPatchIndex < fromPatchIndex;
}

/**
 * Effective change-weight factor for one entity+patch from the applicable
 * ACTIVE breakpoints (SPECS §16): `reset` dominates (0); otherwise the
 * `weight_factor`s multiply, floored at `minWeight`. An empty set is neutral
 * (1). `minWeight` defaults to `ETL_CONFIG.minWeight`.
 */
export function combineBreakpointWeight(
  breakpoints: ReadonlyArray<Pick<DataBreakpoint, 'mode' | 'weightFactor'>>,
  minWeight: number = ETL_CONFIG.minWeight,
): number {
  let product = 1;
  for (const bp of breakpoints) {
    if (bp.mode === 'reset') return 0;
    product *= bp.weightFactor ?? 1;
  }
  return Math.max(product, minWeight);
}
