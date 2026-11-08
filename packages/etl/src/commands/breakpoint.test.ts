import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsageError } from '../cli-args';
import { migrate, openDb } from '../db';
import { seedPatches } from '../patches.test-helpers';
import { breakpointCommand } from './breakpoint';

let directory: string | null = null;
let originalDbPath: string | undefined;

function setupDb(): string {
  directory = mkdtempSync(join(tmpdir(), 'draftorb-breakpoint-cmd-'));
  const dbPath = join(directory, 'test.sqlite');
  originalDbPath = process.env.DRAFTORB_DB_PATH;
  process.env.DRAFTORB_DB_PATH = dbPath;
  const db = openDb(dbPath);
  migrate(db);
  seedPatches(db, ['16.20', '16.21', '16.22']);
  db.close();
  return dbPath;
}

function readRows(dbPath: string): Array<Record<string, unknown>> {
  const db = openDb(dbPath);
  try {
    return db.prepare('SELECT * FROM data_breakpoints ORDER BY id').all() as Array<
      Record<string, unknown>
    >;
  } finally {
    db.close();
  }
}

afterEach(() => {
  if (originalDbPath === undefined) {
    delete process.env.DRAFTORB_DB_PATH;
  } else {
    process.env.DRAFTORB_DB_PATH = originalDbPath;
  }
  originalDbPath = undefined;
  if (directory !== null) {
    rmSync(directory, { recursive: true, force: true });
    directory = null;
  }
  vi.restoreAllMocks();
});

describe('breakpointCommand', () => {
  it('add creates an active manual row; list shows it; validate/reject transition it', async () => {
    const dbPath = setupDb();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await breakpointCommand.run([
      'add',
      '--scope-type=champion',
      '--scope-id=41',
      '--from-patch=16.22',
      '--mode=downweight',
      '--weight-factor=0.5',
      '--reason=hotfix broke Q',
    ]);
    const rows = readRows(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope_type: 'champion',
      scope_id: 41,
      from_patch_index: 3, // '16.22' -> patch_index 3 in the fixture catalog
      mode: 'downweight',
      weight_factor: 0.5,
      status: 'active',
      source: 'manual',
    });
    const id = Number(rows[0]?.id);
    const championRow = () => readRows(dbPath).find((r) => r.scope_type === 'champion');
    const itemRow = () => readRows(dbPath).find((r) => r.scope_type === 'item');

    await breakpointCommand.run(['list']);
    const listOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(listOutput).toContain('champion:41');
    expect(listOutput).toContain('16.22');
    expect(listOutput).toContain('active/manual');

    // An active manual row cannot be validated/rejected (only 'suggested').
    await expect(breakpointCommand.run(['validate', String(id)])).rejects.toThrow(
      /only 'suggested'/,
    );

    // Simulate an auto suggestion, then exercise both transitions.
    const db = openDb(dbPath);
    db.prepare(
      `INSERT INTO data_breakpoints (
        scope_type, scope_id, from_patch_index, mode, weight_factor,
        status, source, reason, created_at
      ) VALUES ('item', 3089, 21, 'reset', NULL, 'suggested', 'auto', 'auto', 1)`,
    ).run();
    db.close();
    const suggestedId = Number(itemRow()?.id);

    await breakpointCommand.run(['validate', String(suggestedId)]);
    expect(itemRow()).toMatchObject({ status: 'active' });
    expect(championRow()).toMatchObject({ status: 'active' });

    const db2 = openDb(dbPath);
    db2.prepare("UPDATE data_breakpoints SET status = 'suggested' WHERE id = ?").run(suggestedId);
    db2.close();
    await breakpointCommand.run(['reject', String(suggestedId)]);
    expect(itemRow()).toMatchObject({ status: 'rejected' });

    log.mockClear();
    await breakpointCommand.run(['list', '--status=rejected']);
    const filtered = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(filtered).toContain('item:3089');
    expect(filtered).not.toContain('champion:41 from 16.22');
  });

  it('rejects usage errors', async () => {
    setupDb();
    await expect(breakpointCommand.run([])).rejects.toThrow(UsageError);
    await expect(breakpointCommand.run(['bogus'])).rejects.toThrow(UsageError);
    await expect(breakpointCommand.run(['add'])).rejects.toThrow(UsageError);
    await expect(
      breakpointCommand.run([
        'add',
        '--scope-type=global',
        '--scope-id=1',
        '--from-patch=16.22',
        '--mode=reset',
        '--reason=x',
      ]),
    ).rejects.toThrow(UsageError);
    await expect(
      breakpointCommand.run([
        'add',
        '--scope-type=champion',
        '--scope-id=41',
        '--from-patch=99.99',
        '--mode=reset',
        '--reason=x',
      ]),
    ).rejects.toThrow(/Unknown patch/);
    await expect(breakpointCommand.run(['validate'])).rejects.toThrow(UsageError);
    await expect(breakpointCommand.run(['validate', 'abc'])).rejects.toThrow(UsageError);
  });
});
