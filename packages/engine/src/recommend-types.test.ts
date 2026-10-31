/**
 * Unit tests for the lane-group configuration (SPECS §5, D-021).
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_LANE_GROUPS as LANE_GROUPS } from './config.js';

describe('LANE_GROUPS', () => {
  it('defines the bot lane for SUPPORT and ADC in role order', () => {
    expect(LANE_GROUPS.SUPPORT).toEqual({
      allies: ['ADC'],
      enemies: ['SUPPORT', 'ADC'],
      oneToOne: false,
    });
    expect(LANE_GROUPS.ADC).toEqual({
      allies: ['SUPPORT'],
      enemies: ['ADC', 'SUPPORT'],
      oneToOne: false,
    });
  });

  it.each(['TOP', 'MID', 'JUNGLE'] as const)('defines %s as a 1v1 lane', (role) => {
    expect(LANE_GROUPS[role]).toEqual({ allies: [], enemies: [role], oneToOne: true });
  });
});
