import { describe, expect, it, vi } from 'vitest';

import { migrate, openDb } from './db';
import {
  comparePatchLabels,
  createPatchResolver,
  ensurePatchCoverage,
  lookupPatchIndex,
  parsePatchLabel,
  parsePatchLabels,
  refreshPatches,
} from './patches';

const versionsResponse = (versions: string[]): typeof fetch =>
  (async () => new Response(JSON.stringify(versions), { status: 200 })) as typeof fetch;

const failingFetch = (message = 'socket hangup'): typeof fetch =>
  (async () => {
    throw new Error(message);
  }) as typeof fetch;

function seedStoredPatch(db: ReturnType<typeof openDb>, matchId: string, patch: string): void {
  db.prepare(
    `INSERT INTO matches (match_id, platform, patch, queue_id, duration, created_at, avg_rank_score)
     VALUES (?, 'euw1', ?, 420, 1800, 1, 6.5)`,
  ).run(matchId, patch);
}

describe('parsePatchLabel', () => {
  it('extracts the major.minor label from full and short versions', () => {
    expect(parsePatchLabel('16.21.1.42')).toBe('16.21');
    expect(parsePatchLabel('16.21')).toBe('16.21');
    expect(parsePatchLabel('14.24.1')).toBe('14.24');
  });

  it('returns null for legacy and malformed entries', () => {
    expect(parsePatchLabel('lolpatch_7.20')).toBeNull();
    expect(parsePatchLabel('not-a-version')).toBeNull();
    expect(parsePatchLabel('')).toBeNull();
  });
});

describe('comparePatchLabels', () => {
  it('orders numerically, never by string compare', () => {
    expect(comparePatchLabels('14.9', '14.10')).toBeLessThan(0);
    expect(comparePatchLabels('14.10', '14.9')).toBeGreaterThan(0);
    expect(comparePatchLabels('15.24', '16.1')).toBeLessThan(0);
    expect(comparePatchLabels('16.10', '16.10')).toBe(0);
  });
});

describe('parsePatchLabels', () => {
  it('orders labels numerically across a season change', () => {
    // 14.24 -> 15.1 orders by (major, minor), and input order does not matter.
    expect(parsePatchLabels(['15.1', '14.24.1', '14.23.1'])).toEqual(['14.23', '14.24', '15.1']);
    expect(parsePatchLabels(['14.23.1', '15.1', '14.24.1'])).toEqual(['14.23', '14.24', '15.1']);
  });

  it('orders 14.9 before 14.10 regardless of input order', () => {
    expect(parsePatchLabels(['14.10.1', '14.9.1'])).toEqual(['14.9', '14.10']);
    expect(parsePatchLabels(['14.9.1', '14.10.1'])).toEqual(['14.9', '14.10']);
  });

  it('collapses hotfixes sharing a major.minor label', () => {
    expect(parsePatchLabels(['16.21.2', '16.21.1', '16.20.1'])).toEqual(['16.20', '16.21']);
  });

  it('skips unparseable entries with a single warning', () => {
    const warnings: string[] = [];
    const labels = parsePatchLabels(['16.1', 'lolpatch_7.20', 'bogus', '16.2.1'], {
      onWarn: (message) => warnings.push(message),
    });
    expect(labels).toEqual(['16.1', '16.2']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('lolpatch_7.20');
    expect(warnings[0]).toContain('bogus');
  });
});

describe('refreshPatches', () => {
  it('populates patches oldest-first with append-only indices', async () => {
    const db = openDb(':memory:');
    migrate(db);

    const first = await refreshPatches(db, {
      fetchFn: versionsResponse(['16.22.1', '16.21.2', '16.21.1', '16.20.1', 'lolpatch_7.20']),
    });
    expect(first).toEqual({ added: 3, total: 3 });
    const rows = db
      .prepare('SELECT patch_index, version_label FROM patches ORDER BY patch_index')
      .all() as Array<{ patch_index: number; version_label: string }>;
    expect(rows).toEqual([
      { patch_index: 1, version_label: '16.20' },
      { patch_index: 2, version_label: '16.21' },
      { patch_index: 3, version_label: '16.22' },
    ]);

    // A second refresh with one new release appends it; existing indices are kept.
    const second = await refreshPatches(db, {
      fetchFn: versionsResponse(['16.23.1', '16.22.1', '16.21.1', '16.20.1']),
    });
    expect(second).toEqual({ added: 1, total: 4 });
    expect(lookupPatchIndex(db, '16.21')).toBe(2);
    expect(lookupPatchIndex(db, '16.23')).toBe(4);
    db.close();
  });

  it('keeps existing indices stable when a new patch is appended', async () => {
    const db = openDb(':memory:');
    migrate(db);
    await refreshPatches(db, {
      fetchFn: versionsResponse(['14.10.1', '14.9.1', '14.8.1']),
    });
    // Numeric order: 14.8 < 14.9 < 14.10 (string order would differ).
    expect(lookupPatchIndex(db, '14.8')).toBe(1);
    expect(lookupPatchIndex(db, '14.9')).toBe(2);
    expect(lookupPatchIndex(db, '14.10')).toBe(3);

    await refreshPatches(db, {
      fetchFn: versionsResponse(['14.11.1', '14.10.1', '14.9.1', '14.8.1']),
    });
    expect(lookupPatchIndex(db, '14.8')).toBe(1);
    expect(lookupPatchIndex(db, '14.9')).toBe(2);
    expect(lookupPatchIndex(db, '14.10')).toBe(3);
    expect(lookupPatchIndex(db, '14.11')).toBe(4);
    db.close();
  });

  it('is a no-op when every label is already known', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const fetchFn = vi.fn(versionsResponse(['16.21.1']));
    await refreshPatches(db, { fetchFn });
    const again = await refreshPatches(db, { fetchFn });
    expect(again).toEqual({ added: 0, total: 1 });
    db.close();
  });

  it('refuses to insert a label that sorts before the newest stored patch', async () => {
    const db = openDb(':memory:');
    migrate(db);
    db.prepare('INSERT INTO patches (patch_index, version_label) VALUES (1, ?)').run('16.20');
    db.prepare('INSERT INTO patches (patch_index, version_label) VALUES (2, ?)').run('16.22');

    // 16.21 is missing from the table but sorts before the newest stored
    // label: appending it would break numeric ordering, so refresh fails.
    await expect(
      refreshPatches(db, {
        fetchFn: versionsResponse(['16.22.1', '16.21.1', '16.20.1']),
      }),
    ).rejects.toThrow(/do not sort after the newest stored patch/);
    db.close();
  });

  it('refuses to refresh a non gap-free or misordered table', async () => {
    const db = openDb(':memory:');
    migrate(db);
    db.prepare('INSERT INTO patches (patch_index, version_label) VALUES (1, ?)').run('16.20');
    db.prepare('INSERT INTO patches (patch_index, version_label) VALUES (3, ?)').run('16.21');
    await expect(
      refreshPatches(db, { fetchFn: versionsResponse(['16.22.1', '16.21.1', '16.20.1']) }),
    ).rejects.toThrow(/not gap-free/);

    const db2 = openDb(':memory:');
    migrate(db2);
    db2.prepare('INSERT INTO patches (patch_index, version_label) VALUES (1, ?)').run('16.10');
    db2.prepare('INSERT INTO patches (patch_index, version_label) VALUES (2, ?)').run('16.9');
    await expect(
      refreshPatches(db2, { fetchFn: versionsResponse(['16.11.1', '16.10.1', '16.9.1']) }),
    ).rejects.toThrow(/not numeric/);
    db.close();
    db2.close();
  });
});

describe('lookupPatchIndex / createPatchIndexLookup', () => {
  it('returns undefined for unknown labels', () => {
    const db = openDb(':memory:');
    migrate(db);
    expect(lookupPatchIndex(db, '16.21')).toBeUndefined();
    db.close();
  });
});

describe('ensurePatchCoverage', () => {
  it('does not fetch when stored labels and extras are covered', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedStoredPatch(db, 'm1', '16.21');
    const fetchFn = vi.fn(versionsResponse(['16.22.1', '16.21.1']));
    const result = await ensurePatchCoverage(db, { fetchFn, extraLabels: ['16.21'] });
    // '16.21' is stored but not in patches -> uncovered -> refresh happens.
    expect(result.status).toBe('refreshed');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.unresolvedLabels).toEqual([]);
    expect(result.orphanLabels).toEqual([]);
    expect(result.orphanMatches).toBe(0);

    const covered = await ensurePatchCoverage(db, { fetchFn, extraLabels: ['16.21', '16.22'] });
    expect(covered.status).toBe('current');
    expect(covered.orphanMatches).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('reports a failed refresh instead of throwing', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedStoredPatch(db, 'm1', '16.21');
    const warnings: string[] = [];
    const result = await ensurePatchCoverage(db, {
      fetchFn: failingFetch(),
      onWarn: (message) => warnings.push(message),
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('socket hangup');
    expect(result.unresolvedLabels).toEqual(['16.21']);
    expect(result.orphanLabels).toEqual(['16.21']);
    expect(result.orphanMatches).toBe(1);
    expect(warnings).toHaveLength(1);
    db.close();
  });

  it('reports orphan labels and match counts for stored labels still missing after refresh', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedStoredPatch(db, 'm1', '16.21');
    seedStoredPatch(db, 'm2', '16.21');
    seedStoredPatch(db, 'm3', '99.1');
    const result = await ensurePatchCoverage(db, {
      fetchFn: versionsResponse(['16.22.1', '16.21.1']),
      extraLabels: ['16.22'],
    });
    expect(result.status).toBe('refreshed');
    expect(result.unresolvedLabels).toEqual(['99.1']);
    expect(result.orphanLabels).toEqual(['99.1']);
    expect(result.orphanMatches).toBe(1);
    db.close();
  });
});

describe('createPatchResolver', () => {
  it('resolves known labels without fetching', async () => {
    const db = openDb(':memory:');
    migrate(db);
    await refreshPatches(db, { fetchFn: versionsResponse(['16.21.1', '16.20.1']) });
    const fetchFn = vi.fn(versionsResponse([]));
    const resolver = createPatchResolver(db, { fetchFn });
    expect(await resolver.resolve('16.21')).toBe(2);
    expect(fetchFn).not.toHaveBeenCalled();
    db.close();
  });

  it('refreshes once on the first miss, then resolves the new label', async () => {
    const db = openDb(':memory:');
    migrate(db);
    await refreshPatches(db, { fetchFn: versionsResponse(['16.21.1']) });
    const fetchFn = vi.fn(versionsResponse(['16.22.1', '16.21.1']));
    const resolver = createPatchResolver(db, { fetchFn });
    expect(await resolver.resolve('16.22')).toBe(2);
    expect(await resolver.resolve('16.21')).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('shares a single fetch between refresh() and resolve() misses', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const fetchFn = vi.fn(versionsResponse(['16.22.1', '16.21.1']));
    const resolver = createPatchResolver(db, { fetchFn });
    await resolver.refresh();
    expect(await resolver.resolve('16.21')).toBe(1);
    expect(await resolver.resolve('16.22')).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('returns undefined when the label is still unknown after refresh', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const resolver = createPatchResolver(db, { fetchFn: versionsResponse(['16.21.1']) });
    expect(await resolver.resolve('99.1')).toBeUndefined();
    db.close();
  });

  it('throws a fetch-flavoured error when the refresh fails', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const resolver = createPatchResolver(db, { fetchFn: failingFetch('connection reset') });
    await expect(resolver.resolve('16.21')).rejects.toThrow(/fetch/i);
    db.close();
  });
});
