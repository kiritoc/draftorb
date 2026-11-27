import { describe, expect, it } from 'vitest';

import type { PickRate, PickRateSamples } from '@draftorb/shared';
import { DEFAULT_CONFIG } from '@draftorb/engine';
import { pickShareDisplay } from './pick-share';

// DEFAULT_CONFIG.minGames is the display minimum (BL-052, D-129).
const pickRate: PickRate = { SUPPORT: { '89': 0.25, '16': 0.75 } };
const samples: PickRateSamples = {
  SUPPORT: { '89': DEFAULT_CONFIG.minGames, '16': DEFAULT_CONFIG.minGames - 1 },
};

describe('pickShareDisplay', () => {
  it('returns the share with its sample at the minimum boundary', () => {
    expect(pickShareDisplay('SUPPORT', 89, pickRate, samples)).toEqual({
      kind: 'rate',
      share: 0.25,
      nEff: DEFAULT_CONFIG.minGames,
    });
  });

  it('returns insufficient below the minimum sample, keeping the known n_eff', () => {
    expect(pickShareDisplay('SUPPORT', 16, pickRate, samples)).toEqual({
      kind: 'insufficient',
      nEff: DEFAULT_CONFIG.minGames - 1,
    });
  });

  it('returns insufficient with a null sample when the champion has no rows', () => {
    expect(pickShareDisplay('SUPPORT', 999, pickRate, samples)).toEqual({
      kind: 'insufficient',
      nEff: null,
    });
  });

  it('returns insufficient when the sample exists but the share does not', () => {
    const shareless: PickRate = { SUPPORT: { '89': 1 } };
    const display = pickShareDisplay('SUPPORT', 16, shareless, samples);
    expect(display).toEqual({ kind: 'insufficient', nEff: DEFAULT_CONFIG.minGames - 1 });
  });

  it('looks up the drafted role only', () => {
    const topOnly: PickRateSamples = { TOP: { '89': 100 } };
    expect(pickShareDisplay('SUPPORT', 89, pickRate, topOnly)).toEqual({
      kind: 'insufficient',
      nEff: null,
    });
  });

  it('returns undefined on legacy exports without the samples file', () => {
    expect(pickShareDisplay('SUPPORT', 89, pickRate, undefined)).toBeUndefined();
  });
});
