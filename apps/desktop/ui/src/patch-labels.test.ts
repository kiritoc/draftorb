import { describe, expect, it } from 'vitest';
import { patchLabels } from './patch-labels';

describe('patchLabels', () => {
  it.each([
    ['16.22', '26.22'],
    ['16.1', '26.1'],
  ])('maps %s to public %s', (internal, pub) => {
    expect(patchLabels(internal)).toEqual({ internal, public: pub });
  });

  it.each(['15.24', '17.1', '16.22.1', 'abc', '16.x', ''])(
    'has no public name for %j',
    (internal) => {
      expect(patchLabels(internal)).toEqual({ internal, public: null });
    },
  );
});
