/**
 * Summoner-spell display-name tests (BL-031b): known ids resolve to names,
 * unknown ids fall back to a labeled `Spell <id>` (golden rule 8).
 */

import { describe, expect, it } from 'vitest';

import { summonerSpellName, summonerSpellPairLabel } from './summoner-spells';

describe('summonerSpellName', () => {
  it('resolves the standard spell ids', () => {
    expect(summonerSpellName(4)).toBe('Flash');
    expect(summonerSpellName(14)).toBe('Ignite');
    expect(summonerSpellName(12)).toBe('Teleport');
    expect(summonerSpellName(7)).toBe('Heal');
  });

  it('resolves _Jade role-quest variants to the base spell name', () => {
    expect(summonerSpellName(712)).toBe('Teleport');
    expect(summonerSpellName(714)).toBe('Ignite');
  });

  it('falls back to a labeled name for unknown ids', () => {
    expect(summonerSpellName(999999)).toBe('Spell 999999');
  });
});

describe('summonerSpellPairLabel', () => {
  it('joins the two spell names', () => {
    expect(summonerSpellPairLabel([4, 14])).toBe('Flash + Ignite');
    expect(summonerSpellPairLabel([12, 4])).toBe('Teleport + Flash');
  });
});
