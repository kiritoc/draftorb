import { describe, expect, it } from 'vitest';

import type { ChampionId, Role } from '@draftorb/shared';
import {
  candidateFeatures,
  candidateLogits,
  contextFeatures,
  featuresLogit,
  fitJointModel,
  pairKey,
  type JointSlot,
  type JointTrainingRow,
} from '../src/joint/index.js';

const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function slot(championId: number, role: Role, side: 'ally' | 'enemy'): JointSlot {
  return { championId: championId as ChampionId, role, side };
}

/** Deterministic PRNG (mulberry32) — test-only synthetic data generation. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDraft(rand: () => number): { ally: JointSlot[]; enemy: JointSlot[] } {
  const used = new Set<number>();
  const draw = (): number => {
    let id = 0;
    do {
      id = 1 + Math.floor(rand() * 30);
    } while (used.has(id));
    used.add(id);
    return id;
  };
  const ally = ROLES.map((role) => slot(draw(), role, 'ally'));
  const enemy = ROLES.map((role) => slot(draw(), role, 'enemy'));
  return { ally, enemy };
}

function rowFromDraft(ally: JointSlot[], enemy: JointSlot[], label: 0 | 1): JointTrainingRow {
  return { label, features: contextFeatures(ally, enemy) };
}

describe('joint model features', () => {
  it('candidate features omit constant draft terms', () => {
    const ally = [slot(1, 'TOP', 'ally'), slot(2, 'JUNGLE', 'ally')];
    const enemy = [slot(3, 'TOP', 'enemy')];
    const features = candidateFeatures(5, 7, ally, enemy);
    // 1 main + 2 ally pairs + 1 enemy pair + 0 lane (role MID vs TOP/JUNGLE? role=5? no)
    expect(features.some((f) => f.layer === 'champMain')).toBe(true);
    expect(features.filter((f) => f.layer === 'allyPair')).toHaveLength(2);
    expect(features.filter((f) => f.layer === 'enemyPair')).toHaveLength(1);
    // No pair among known slots appears (those are constant across candidates).
    expect(features.some((f) => f.key === pairKey(1, 2))).toBe(false);
  });

  it('laneVs fires only for same-role enemy matchups', () => {
    const midEnemy = [slot(9, 'MID', 'enemy')];
    const jungleEnemy = [slot(9, 'JUNGLE', 'enemy')];
    const midFeatures = candidateFeatures('MID', 5, [], midEnemy);
    const topFeatures = candidateFeatures('TOP', 5, [], jungleEnemy);
    expect(midFeatures.some((f) => f.layer === 'laneVs')).toBe(true);
    expect(topFeatures.some((f) => f.layer === 'laneVs')).toBe(false);
  });
});

describe('fitJointModel', () => {
  it('is deterministic: identical rows produce identical params', () => {
    const rand = rng(42);
    const rows = Array.from({ length: 200 }, () => {
      const { ally, enemy } = randomDraft(rand);
      return rowFromDraft(ally, enemy, rand() > 0.5 ? 1 : 0);
    });
    const a = fitJointModel(rows, { l2: 0.01, iterations: 20, learningRate: 0.2 });
    const b = fitJointModel(rows, { l2: 0.01, iterations: 20, learningRate: 0.2 });
    expect(a).toEqual(b);
  });

  it('recovers a planted ally-pair synergy (planted-effect gate)', () => {
    // Champions 3 and 7 on the same team always win; everything else is coin flip.
    const rand = rng(7);
    const rows: JointTrainingRow[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const { ally, enemy } = randomDraft(rand);
      const hasPair = (slots: JointSlot[]) =>
        slots.some((s) => s.championId === 3) && slots.some((s) => s.championId === 7);
      let label: 0 | 1;
      if (hasPair(ally)) label = 1;
      else if (hasPair(enemy)) label = 0;
      else label = rand() > 0.5 ? 1 : 0;
      rows.push(rowFromDraft(ally, enemy, label));
    }

    const params = fitJointModel(rows, {
      l2: 0.0005,
      iterations: 300,
      learningRate: 0.3,
    });

    const synergy = params.allyPair[pairKey(3, 7)] ?? 0;
    expect(synergy).toBeGreaterThan(0.3);

    // A draft containing the pair on the ally side must outscore the mirror.
    const pairAlly = [
      slot(3, 'TOP', 'ally'),
      slot(7, 'JUNGLE', 'ally'),
      slot(11, 'MID', 'ally'),
      slot(12, 'ADC', 'ally'),
      slot(13, 'SUPPORT', 'ally'),
    ];
    const filler = [11, 12, 13, 14, 15].map((id, i) => slot(id, ROLES[(i + 2) % 5]!, 'enemy'));
    const withPair = featuresLogit(params, contextFeatures(pairAlly, filler));
    const mirrorEnemy = [
      slot(3, 'TOP', 'enemy'),
      slot(7, 'JUNGLE', 'enemy'),
      slot(11, 'MID', 'enemy'),
      slot(12, 'ADC', 'enemy'),
      slot(13, 'SUPPORT', 'enemy'),
    ];
    const allyFiller = [14, 15, 16, 17, 18].map((id, i) => slot(id, ROLES[i]!, 'ally'));
    const withoutPair = featuresLogit(params, contextFeatures(allyFiller, mirrorEnemy));
    expect(withPair).toBeGreaterThan(withoutPair);
  });
});

describe('candidateLogits', () => {
  it('ranks a synergistic candidate above an unknown one', () => {
    const params = {
      version: 1 as const,
      bias: 0,
      champMain: {},
      allyPair: { [pairKey(4, 8)]: 2 },
      enemyPair: {},
      laneVs: {},
      l2: 0,
      iterations: 0,
      learningRate: 0,
    };
    const ally = [slot(4, 'TOP', 'ally')];
    const logits = candidateLogits(params, 'JUNGLE', [8, 20], ally, []);
    expect(logits.get(8)).toBeGreaterThan(logits.get(20)!);
    expect(logits.get(20)).toBe(0);
  });
});
