import { parseArgs } from 'node:util';

import { resolveDbPath } from '../config/paths';
import { openDb, migrate } from '../db';
import { UsageError, parseStrictPositiveInt } from '../cli-args';
import {
  BREAKPOINT_MODES,
  BREAKPOINT_SCOPE_TYPES,
  BREAKPOINT_STATUSES,
  addBreakpoint,
  listBreakpoints,
  rejectBreakpoint,
  validateBreakpoint,
  type BreakpointMode,
  type BreakpointScopeType,
  type BreakpointStatus,
} from '../breakpoints';
import { lookupPatchIndex } from '../patches';
import { log, type Command } from './shared';

const USAGE =
  'breakpoint <list|add|validate|reject> ...\n' +
  '  list [--status=suggested|active|rejected]\n' +
  '  add --scope-type=champion|item|rune|global [--scope-id=N] ' +
  '--from-patch=<label> --mode=reset|downweight [--weight-factor=F] --reason="..."\n' +
  '  validate <id>\n' +
  '  reject <id>';

function openMigratedDb() {
  const db = openDb(resolveDbPath());
  migrate(db);
  return db;
}

function parseSubcommand(args: string[]): [string, string[]] {
  const [sub, ...rest] = args;
  if (sub === undefined || ['help', '--help', '-h'].includes(sub)) {
    throw new UsageError(`Missing breakpoint subcommand.\nUsage: ${USAGE}`);
  }
  if (!['list', 'add', 'validate', 'reject'].includes(sub)) {
    throw new UsageError(`Unknown breakpoint subcommand "${sub}".\nUsage: ${USAGE}`);
  }
  return [sub, rest];
}

function runList(args: string[]): void {
  let status: BreakpointStatus | undefined;
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: { status: { type: 'string' } },
    });
    if (parsed.positionals.length > 0) {
      throw new UsageError(`Too many positional arguments.\nUsage: breakpoint list [--status=S]`);
    }
    const raw = parsed.values.status;
    if (raw !== undefined) {
      if (!(BREAKPOINT_STATUSES as readonly string[]).includes(raw)) {
        throw new UsageError(
          `Invalid --status "${raw}". Expected one of: ${BREAKPOINT_STATUSES.join(', ')}.`,
        );
      }
      status = raw as BreakpointStatus;
    }
  } catch (error: unknown) {
    if (error instanceof UsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: breakpoint list [--status=S]`);
  }

  const db = openMigratedDb();
  try {
    const rows = listBreakpoints(db, status);
    if (rows.length === 0) {
      log.info('No breakpoints.');
      return;
    }
    for (const row of rows) {
      const scope =
        row.scopeType === 'global' ? 'global' : `${row.scopeType}:${row.scopeId ?? '?'}`;
      const factor = row.mode === 'downweight' ? ` factor=${row.weightFactor}` : '';
      const patch = row.patchLabel ?? `index ${row.fromPatchIndex}`;
      log.info(
        `#${row.id} ${scope} from ${patch} (index ${row.fromPatchIndex}) ` +
          `${row.mode}${factor} [${row.status}/${row.source}] ${row.reason}`,
      );
    }
  } finally {
    db.close();
  }
}

function runAdd(args: string[]): void {
  let values: Record<string, string | boolean | undefined>;
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        'scope-type': { type: 'string' },
        'scope-id': { type: 'string' },
        'from-patch': { type: 'string' },
        mode: { type: 'string' },
        'weight-factor': { type: 'string' },
        reason: { type: 'string' },
      },
    });
    values = parsed.values;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: breakpoint add ...`);
  }

  const scopeTypeRaw = values['scope-type'];
  if (
    typeof scopeTypeRaw !== 'string' ||
    !(BREAKPOINT_SCOPE_TYPES as readonly string[]).includes(scopeTypeRaw)
  ) {
    throw new UsageError(
      `--scope-type is required and must be one of: ${BREAKPOINT_SCOPE_TYPES.join(', ')}.`,
    );
  }
  const scopeType = scopeTypeRaw as BreakpointScopeType;

  const scopeId = parseStrictPositiveInt(
    typeof values['scope-id'] === 'string' ? values['scope-id'] : undefined,
    '--scope-id',
  );
  if (scopeType === 'global' && scopeId !== undefined) {
    throw new UsageError('--scope-id must be omitted for --scope-type=global.');
  }
  if (scopeType !== 'global' && scopeId === undefined) {
    throw new UsageError(`--scope-id is required for --scope-type=${scopeType}.`);
  }

  const fromPatchRaw = values['from-patch'];
  if (typeof fromPatchRaw !== 'string' || fromPatchRaw.length === 0) {
    throw new UsageError('--from-patch <version label> is required (e.g. --from-patch=16.22).');
  }

  const modeRaw = values.mode;
  if (typeof modeRaw !== 'string' || !(BREAKPOINT_MODES as readonly string[]).includes(modeRaw)) {
    throw new UsageError(`--mode is required and must be one of: ${BREAKPOINT_MODES.join(', ')}.`);
  }
  const mode = modeRaw as BreakpointMode;

  let weightFactor: number | undefined;
  const factorRaw = values['weight-factor'];
  if (factorRaw !== undefined) {
    const parsed = Number(typeof factorRaw === 'string' ? factorRaw : '');
    if (!Number.isFinite(parsed)) {
      throw new UsageError(`Invalid --weight-factor "${String(factorRaw)}".`);
    }
    weightFactor = parsed;
  }

  const reason = values.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new UsageError('--reason "..." is required (mandatory for manual breakpoints).');
  }

  const db = openMigratedDb();
  try {
    const fromPatchIndex = lookupPatchIndex(db, fromPatchRaw);
    if (fromPatchIndex === undefined) {
      throw new UsageError(
        `Unknown patch "${fromPatchRaw}": not present in the patches table ` +
          '(run `pnpm etl aggregate` or `matches` to refresh it from Data Dragon first).',
      );
    }
    const row = addBreakpoint(db, {
      scopeType,
      ...(scopeId !== undefined ? { scopeId } : {}),
      fromPatchIndex,
      mode,
      ...(weightFactor !== undefined ? { weightFactor } : {}),
      reason,
    });
    log.info(
      `Created breakpoint #${row.id}: ${row.scopeType}` +
        `${row.scopeId === null ? '' : ` ${row.scopeId}`} from ${fromPatchRaw} ` +
        `${row.mode} [${row.status}/${row.source}]`,
    );
  } finally {
    db.close();
  }
}

function runTransition(args: string[], action: 'validate' | 'reject'): void {
  const [idArg, ...rest] = args;
  if (idArg === undefined || rest.length > 0) {
    throw new UsageError(`Usage: breakpoint ${action} <id>`);
  }
  const id = parseStrictPositiveInt(idArg, 'id');
  if (id === undefined) {
    throw new UsageError(`Usage: breakpoint ${action} <id>`);
  }

  const db = openMigratedDb();
  try {
    const row = action === 'validate' ? validateBreakpoint(db, id) : rejectBreakpoint(db, id);
    log.info(`Breakpoint #${row.id} is now '${row.status}'.`);
  } finally {
    db.close();
  }
}

async function runBreakpoint(args: string[]): Promise<void> {
  const [sub, rest] = parseSubcommand(args);
  if (sub === 'list') runList(rest);
  else if (sub === 'add') runAdd(rest);
  else runTransition(rest, sub as 'validate' | 'reject');
}

export const breakpointCommand: Command = {
  name: 'breakpoint',
  usage: 'breakpoint <list|add|validate|reject> ...',
  description:
    'Manage data breakpoints: list, add manual ones, validate/reject suggestions (SPECS §16)',
  run: runBreakpoint,
};
