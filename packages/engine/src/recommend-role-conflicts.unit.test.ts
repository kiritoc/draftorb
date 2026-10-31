/**
 * Unit tests for role-conflict helpers (D-030).
 */

import { describe, it, expect } from 'vitest';
import type { ChampionRoleProbabilities } from '@draftorb/shared';
import {
  dedupeTeamSlots,
  resolveViableSubset,
  uniqueFixedSlots,
} from './recommend-role-conflicts.js';

const roleProb = {
  '201': { ADC: 1 },
  '300': { ADC: 1 },
  '302': { MID: 1 },
} as ChampionRoleProbabilities;

describe('dedupeTeamSlots', () => {
  it('keeps the first copy, preferring a fixed copy', () => {
    expect(
      dedupeTeamSlots([{ championId: 1 }, { championId: 1, role: 'TOP' }, { championId: 2 }]),
    ).toEqual([{ championId: 1, role: 'TOP' }, { championId: 2 }]);
    expect(dedupeTeamSlots([{ championId: 3 }, { championId: 3 }])).toEqual([{ championId: 3 }]);
  });
});

describe('resolveViableSubset', () => {
  it('starts from fixed slots and adds only unfixed slots that keep inference valid', () => {
    const { source, resolved } = resolveViableSubset(
      [{ championId: 201, role: 'ADC' }, { championId: 300 }, { championId: 302 }],
      roleProb,
    );
    expect(source.map((s) => s.championId)).toEqual([201, 302]);
    expect(resolved?.slots.map((s) => s.championId).sort((a, b) => a - b)).toEqual([201, 302]);
  });

  it('returns null when nothing can be resolved', () => {
    expect(resolveViableSubset([{ championId: 999 }], roleProb).resolved).toBeNull();
  });
});

describe('uniqueFixedSlots', () => {
  it('drops fixed roles used more than once and ignores unfixed slots', () => {
    expect(
      uniqueFixedSlots(
        [
          { championId: 1, role: 'SUPPORT' },
          { championId: 2, role: 'SUPPORT' },
          { championId: 3, role: 'ADC' },
          { championId: 4 },
        ],
        'enemy',
      ),
    ).toEqual([{ championId: 3, role: 'ADC', side: 'enemy', confidence: 1, fixed: true }]);
  });
});
