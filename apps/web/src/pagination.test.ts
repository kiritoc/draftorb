import { describe, expect, it } from 'vitest';

import { paginate } from './pagination.js';

describe('paginate', () => {
  it('splits into exact page boundaries', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(paginate(items, 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12],
    ]);
  });

  it('returns no pages for an empty list', () => {
    expect(paginate([], 5)).toEqual([]);
  });

  it('returns a single page when the list is shorter than a page', () => {
    expect(paginate([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('does not emit a trailing empty page for an exact multiple', () => {
    expect(paginate([1, 2, 3, 4, 5], 5)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('returns one item per page for pageSize of 1', () => {
    expect(paginate(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
  });

  it('rejects a non-positive pageSize', () => {
    expect(() => paginate([1], 0)).toThrow(/pageSize/);
    expect(() => paginate([1], -1)).toThrow(/pageSize/);
  });
});
