/**
 * Unit tests for known-slot and lane-group resolution (T-023, SPECS §4-5, D-030).
 */

import { describe, it, expect } from 'vitest';
import type { ChampionRoleProbabilities } from '@draftorb/shared';
import type { KnownSlot } from './recommend-types.js';
import { LANE_GROUPS } from './recommend-types.js';
import { computeLaneGroup, resolveKnownSlots } from './recommend-slots.js';

const roleProb = {
  '50': { MID: 0.8, SUPPORT: 0.2 },
  '200': { SUPPORT: 1 },
  '201': { ADC: 1 },
  '300': { ADC: 1 },
  '302': { MID: 1 },
} as ChampionRoleProbabilities;

function slot(championId: number, role: KnownSlot['role'], confidence = 1): KnownSlot {
  return { championId, role, side: 'enemy', confidence, fixed: confidence === 1 };
}

describe('resolveKnownSlots', () => {
  it('returns no slots for an empty team', () => {
    expect(resolveKnownSlots([], 'enemy', roleProb)).toEqual([]);
  });

  it('keeps a fixed role with confidence 1', () => {
    expect(resolveKnownSlots([{ championId: 200, role: 'SUPPORT' }], 'ally', roleProb)).toEqual([
      { championId: 200, role: 'SUPPORT', side: 'ally', confidence: 1, fixed: true },
    ]);
  });

  it('infers an unfixed role with its marginal confidence', () => {
    const [s] = resolveKnownSlots([{ championId: 50 }], 'enemy', roleProb);
    expect(s?.role).toBe('MID');
    expect(s?.confidence).toBeCloseTo(0.8, 12);
    expect(s?.fixed).toBe(false);
  });

  it('drops only the conflicting unfixed pick and keeps resolvable teammates', () => {
    const slots = resolveKnownSlots(
      [{ championId: 201, role: 'ADC' }, { championId: 300 }, { championId: 302 }],
      'enemy',
      roleProb,
    );
    expect(slots.map((s) => [s.championId, s.role])).toEqual([
      [201, 'ADC'],
      [302, 'MID'],
    ]);
  });

  it('drops a team member without roleProb but keeps the rest', () => {
    const slots = resolveKnownSlots([{ championId: 201 }, { championId: 999 }], 'ally', roleProb);
    expect(slots.map((s) => s.championId)).toEqual([201]);
  });

  it('keeps the fixed copy of a duplicated champion even when an unfixed copy comes first', () => {
    // 999 has no roleProb: only its fixed role can place it.
    expect(
      resolveKnownSlots([{ championId: 999 }, { championId: 999, role: 'TOP' }], 'enemy', roleProb),
    ).toEqual([{ championId: 999, role: 'TOP', side: 'enemy', confidence: 1, fixed: true }]);
  });

  it('drops duplicated fixed roles and keeps unique fixed ones (D-030)', () => {
    const slots = resolveKnownSlots(
      [
        { championId: 200, role: 'SUPPORT' },
        { championId: 50, role: 'SUPPORT' },
        { championId: 201, role: 'ADC' },
      ],
      'enemy',
      roleProb,
    );
    expect(slots).toEqual([
      { championId: 201, role: 'ADC', side: 'enemy', confidence: 1, fixed: true },
    ]);
  });
});

describe('computeLaneGroup', () => {
  it('orders bot-lane enemies by laneGroup role order and multiplies confidences', () => {
    const info = computeLaneGroup(
      LANE_GROUPS.SUPPORT,
      [{ ...slot(10, 'ADC', 0.5), side: 'ally' }],
      [slot(201, 'ADC', 0.8), slot(302, 'MID'), slot(200, 'SUPPORT', 0.5)],
    );
    expect(info.enemies.map((s) => s.championId)).toEqual([200, 201]);
    expect(info.enemiesKnown).toEqual(['SUPPORT', 'ADC']);
    expect(info.alliesKnown).toEqual(['ADC']);
    expect(info.enemyConfidence).toBeCloseTo(0.4, 12);
    expect(info.confidence).toBeCloseTo(0.2, 12);
  });

  it('uses the ADC ordering [ADC, SUPPORT] for userRole ADC', () => {
    const info = computeLaneGroup(LANE_GROUPS.ADC, [], [slot(200, 'SUPPORT'), slot(201, 'ADC')]);
    expect(info.enemies.map((s) => s.championId)).toEqual([201, 200]);
  });

  it('has no allies and confidence 1 for an empty 1v1 lane', () => {
    const info = computeLaneGroup(LANE_GROUPS.TOP, [], []);
    expect(info.allies).toEqual([]);
    expect(info.enemies).toEqual([]);
    expect(info.confidence).toBe(1);
    expect(info.enemyConfidence).toBe(1);
  });
});
