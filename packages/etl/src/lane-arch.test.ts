import { describe, expect, it } from 'vitest';

import { laneArchKey } from '@draftorb/engine';
import type { ChampionTagsMap } from '@draftorb/shared';

import { formatSlot, type LaneSlot } from './aggregate-runes-context';

/**
 * ETL/engine key parity (D-086): the lane_key strings produced by the ETL
 * `formatSlot`/`lane:` convention must be parseable by the engine
 * `laneArchKey`, and the worked backoff example must resolve to the most
 * influential slot's archetype.
 */
describe('lane key parity', () => {
  const tags = {
    '21': { archetype: 'marksman', damageType: 'AD' },
    '266': { archetype: 'enchanter', damageType: 'AP' },
    '412': { archetype: 'enchanter', damageType: 'AP' },
  } as unknown as ChampionTagsMap;

  it('engine laneArchKey reads the first (most influential) ETL slot', () => {
    const slots: LaneSlot[] = [
      { side: 'e', role: 'SUPPORT', championId: 266 },
      { side: 'a', role: 'ADC', championId: 21 },
      { side: 'a', role: 'SUPPORT', championId: 412 },
    ];
    const laneKey = `lane:${slots.map(formatSlot).join('|')}`;
    expect(laneKey).toBe('lane:e.SUPPORT:266|a.ADC:21|a.SUPPORT:412');
    expect(laneArchKey(laneKey, tags)).toBe('enchanter');
  });

  it('worked backoff: exact key -> archetype -> role -> global', () => {
    // Exact lane matchup is sparse; archetype collapses it.
    const exactA = 'lane:e.SUPPORT:266|a.ADC:21';
    const exactB = 'lane:e.SUPPORT:999|a.ADC:22'; // different champs, same archetypes
    expect(laneArchKey(exactA, tags)).toBe('enchanter');
    expect(laneArchKey(exactB, tags)).toBe(''); // 999/22 untagged -> no arch
    // Untagged champions yield '' so callers fall back to role/global.
    expect(laneArchKey('', tags)).toBe('');
    expect(laneArchKey('mid', tags)).toBe('');
  });
});
