import { describe, expect, it, vi } from 'vitest';

import { migrate, openDb } from './db';
import {
  createPatchResolver,
  ensurePatchesFresh,
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

describe('parsePatchLabels', () => {
  it('reverses newest-first versions to oldest-first labels', () => {
    // Season boundary: source order decides, never a numeric compare (14.24 -> 15.1).
    expect(parsePatchLabels(['15.1', '14.24.1', '14.23.1'])).toEqual(['14.23', '14.24', '15.1']);
  });

  it('collapses hotfixes sharing a major.minor label', () => {
    expect(parsePatchLabels(['16.21.2', '16.21.1', '16.20.1'])).toEqual(['16.20', '16.21']);
  });

  it('ignores legacy lolpatch_* entries', () => {
    expect(parsePatchLabels(['16.1', 'lolpatch_7.20', 'lolpatch_6.18'])).toEqual(['16.1']);
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

  it('is a no-op when every label is already known', async () => {
    const db = openDb(':memory:');
    migrate(db);
    const fetchFn = vi.fn(versionsResponse(['16.21.1']));
    await refreshPatches(db, { fetchFn });
    const again = await refreshPatches(db, { fetchFn });
    expect(again).toEqual({ added: 0, total: 1 });
    db.close();
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

describe('ensurePatchesFresh', () => {
  it('does not fetch when stored labels and extras are covered', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedStoredPatch(db, 'm1', '16.21');
    const fetchFn = vi.fn(versionsResponse(['16.22.1', '16.21.1']));
    const result = await ensurePatchesFresh(db, { fetchFn, extraLabels: ['16.21'] });
    // '16.21' is stored but not in patches -> uncovered -> refresh happens.
    expect(result.status).toBe('refreshed');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const covered = await ensurePatchesFresh(db, { fetchFn, extraLabels: ['16.21', '16.22'] });
    expect(covered.status).toBe('current');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('reports a failed refresh instead of throwing', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedStoredPatch(db, 'm1', '16.21');
    const warnings: string[] = [];
    const result = await ensurePatchesFresh(db, {
      fetchFn: failingFetch(),
      onWarn: (message) => warnings.push(message),
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('socket hangup');
    expect(warnings).toHaveLength(1);
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
