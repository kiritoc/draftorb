import { describe, expect, it } from 'vitest';
import { emptyPool, setChampionRoles } from './pool-model';
import { poolSyncStatus } from './pool-sync';

const withChamps = (ids: number[]) =>
  ids.reduce((pool, id) => setChampionRoles(pool, id, ['TOP'], `n${id}`).pool, emptyPool());

describe('poolSyncStatus', () => {
  it('has no folder when there is no repo result', () => {
    expect(poolSyncStatus(emptyPool(), null)).toEqual({ kind: 'noFolder' });
  });

  it('reports a missing file', () => {
    expect(poolSyncStatus(emptyPool(), { pool: emptyPool(), missing: true })).toEqual({
      kind: 'missingFile',
    });
  });

  it('reports an invalid file or unreadable folder with its notice', () => {
    expect(
      poolSyncStatus(emptyPool(), { pool: emptyPool(), missing: false, notice: 'bad' }),
    ).toEqual({ kind: 'invalid', notice: 'bad' });
    expect(
      poolSyncStatus(emptyPool(), { pool: emptyPool(), missing: true, notice: 'no data/' }).kind,
    ).toBe('invalid');
  });

  it('is in sync when the id sets match, ignoring order and names', () => {
    const repo = withChamps([2, 1]);
    const program = setChampionRoles(withChamps([1]), 2, ['TOP'], 'other').pool;
    expect(poolSyncStatus(program, { pool: repo, missing: false })).toEqual({ kind: 'inSync' });
  });

  it('differs when the id sets differ', () => {
    expect(poolSyncStatus(withChamps([1]), { pool: withChamps([1, 2]), missing: false })).toEqual({
      kind: 'differs',
    });
  });
});
