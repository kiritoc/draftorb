import { describe, expect, it } from 'vitest';

import { warningText } from './RecommendationCard.js';

const champions = [{ id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT' as const] }];

describe('recommendation warning text', () => {
  it('renders hard-counter codes with the champion name', () => {
    expect(warningText('counteredBy:SUPPORT:89', champions)).toContain('Leona');
  });

  it('renders the off-role code as readable text', () => {
    expect(warningText('offRole', champions)).toContain('rarely played');
  });
});
