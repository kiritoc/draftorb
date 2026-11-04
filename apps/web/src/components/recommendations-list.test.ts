import { describe, expect, it } from 'vitest';

import { pageCountReducer } from './RecommendationsList.js';

describe('recommendations pagination state', () => {
  it('reveals one page at a time and stops at the last page', () => {
    expect(pageCountReducer(1, { type: 'showMore', maxPages: 3 })).toBe(2);
    expect(pageCountReducer(3, { type: 'showMore', maxPages: 3 })).toBe(3);
  });

  it('resets to the first page when the draft input changes', () => {
    expect(pageCountReducer(4, { type: 'reset' })).toBe(1);
  });
});
