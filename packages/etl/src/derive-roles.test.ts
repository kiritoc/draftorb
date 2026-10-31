import { describe, expect, it } from 'vitest';

import type { ChampionRoleProbabilities, ChampionsMap } from '@draftorb/shared';

import { applyDerivedRoles, deriveChampionRoles } from './derive-roles';

describe('deriveChampionRoles', () => {
  it('derives a single observed role for a one-trick champion', () => {
    expect(deriveChampionRoles({ '412': { SUPPORT: 1 } })).toEqual({ '412': ['SUPPORT'] });
  });

  it('derives all observed roles for a flex champion in canonical order', () => {
    const roleProb: ChampionRoleProbabilities = {
      '99': { MID: 0.7, SUPPORT: 0.3 },
    };
    expect(deriveChampionRoles(roleProb)).toEqual({ '99': ['MID', 'SUPPORT'] });
  });

  it('ignores input key order and always emits canonical role order', () => {
    const roleProb: ChampionRoleProbabilities = {
      '99': { SUPPORT: 0.3, MID: 0.7 },
    };
    expect(deriveChampionRoles(roleProb)).toEqual({ '99': ['MID', 'SUPPORT'] });
  });

  it('excludes roles with zero observed probability', () => {
    const roleProb: ChampionRoleProbabilities = { '1': { MID: 1, SUPPORT: 0 } };
    expect(deriveChampionRoles(roleProb)).toEqual({ '1': ['MID'] });
  });

  it('does not list champions that have no role-prob entry', () => {
    const result = deriveChampionRoles({ '1': { SUPPORT: 1 } });
    expect(result).not.toHaveProperty('2');
    expect(Object.keys(result)).toEqual(['1']);
  });

  it('returns an empty record for an empty role-probability map', () => {
    expect(deriveChampionRoles({})).toEqual({});
  });
});

describe('applyDerivedRoles', () => {
  const champions = {
    '1': { id: 1, name: 'Annie', icon: 'Annie.png', roles: ['MID', 'SUPPORT'] },
    '412': { id: 412, name: 'Thresh', icon: 'Thresh.png', roles: ['SUPPORT'] },
  };

  it('replaces observed champions with derived roles and keeps bootstrap roles for the rest', () => {
    const roleProb: ChampionRoleProbabilities = {
      '412': { SUPPORT: 1 },
    };
    const updated = applyDerivedRoles(champions as unknown as ChampionsMap, roleProb);
    const thresh = Object.values(updated).find((champion) => champion.id === 412);
    expect(thresh?.roles).toEqual(['SUPPORT']);
    const annie = Object.values(updated).find((champion) => champion.id === 1);
    expect(annie?.roles).toEqual(['MID', 'SUPPORT']);
  });

  it('keeps every bootstrap role when the role-probability map is empty', () => {
    const updated = applyDerivedRoles(champions as unknown as ChampionsMap, {});
    const thresh = Object.values(updated).find((champion) => champion.id === 412);
    expect(thresh?.roles).toEqual(['SUPPORT']);
    const annie = Object.values(updated).find((champion) => champion.id === 1);
    expect(annie?.roles).toEqual(['MID', 'SUPPORT']);
  });
});
