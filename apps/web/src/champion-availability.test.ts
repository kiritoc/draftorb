import { describe, expect, it } from 'vitest';

import { type Champion } from '@draftorb/shared';
import { championsForSlot } from './champion-availability.js';

const champions: Champion[] = [
  { id: 1, name: 'Annie', icon: 'Annie.png', roles: ['MID'] },
  { id: 2, name: 'Olaf', icon: 'Olaf.png', roles: ['TOP'] },
  { id: 412, name: 'Soraka', icon: 'Soraka.png', roles: ['SUPPORT'] },
];

describe('championsForSlot', () => {
  it('excludes champions used by other slots', () => {
    const available = championsForSlot(champions, new Set([1, 412]), null);
    expect(available.map((c) => c.id)).toEqual([2]);
  });

  it('keeps the slot’s own pick visible', () => {
    const available = championsForSlot(champions, new Set([1, 412]), 412);
    expect(available.map((c) => c.id)).toEqual([2, 412]);
  });

  it('returns the full catalogue when nothing is picked', () => {
    expect(championsForSlot(champions, new Set(), null)).toHaveLength(3);
  });
});
