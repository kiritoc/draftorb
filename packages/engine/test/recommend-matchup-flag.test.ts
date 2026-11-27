/**
 * recommend(): `matchupEnabled` / `matchupShrinkK` (D-127, BL-014).
 *
 * `matchupEnabled: false` must reduce the score to the champion baseline
 * prior exactly — no pair/lane/comp/blind terms, no matchup reasons or
 * warnings — while `true` preserves the deployed behavior. `matchupShrinkK`
 * partially pools every table-derived matchup term toward 0.
 */

import { describe, it, expect } from 'vitest';
import type { BaselineTable } from '@draftorb/shared';
import { recommend } from '../src/recommend.js';
import { DEFAULT_CONFIG, DEFAULT_RECOMMEND_CONFIG } from '../src/config.js';
import { indexBaselines } from '../src/recommend-indexes.js';
import { baselinePrior } from '../src/levels.js';
import {
  BOT_ROLE_PROB,
  HIGH_GAMES,
  makeData,
  makeEnemyPairs,
  makeInput,
} from '../src/recommend-test-utils.js';

/** Champion 2 is slightly weaker on baseline but has a strong enemy pair vs
 *  200, so the matchup layer flips the order when enabled. */
function matchupFixture() {
  const baselines: BaselineTable = [
    [1, 'DIAMOND', 30, 50, 0.1, 50],
    [2, 'DIAMOND', 28, 50, 0.1, 50],
  ];
  const enemyPairs = makeEnemyPairs([
    { championId: 2, enemyId: 200, role: 'SUPPORT', ...HIGH_GAMES, winsW: 45 },
  ]);
  const data = makeData({
    champions: [1, 2, 200],
    baselines,
    enemyPairs,
    roleProb: BOT_ROLE_PROB,
    // No tags: compNeed has no sample size and is never shrunk (D-127), so
    // the fixtures isolate the table-derived matchup terms.
    tags: {},
  });
  const input = makeInput({ enemies: [{ championId: 200, role: 'SUPPORT' }] });
  return { data, input, baselines };
}

describe('recommend: matchupEnabled flag', () => {
  it('scores exactly the champion baseline win rate when disabled', () => {
    const { data, input, baselines } = matchupFixture();
    const off = { ...DEFAULT_CONFIG, matchupEnabled: false };
    const result = recommend(input, data, off, DEFAULT_RECOMMEND_CONFIG);

    const baselineIdx = indexBaselines(baselines, 'DIAMOND');
    for (const rec of result.recommendations) {
      const row = baselineIdx.get(rec.championId);
      expect(row).toBeDefined();
      if (row === undefined) throw new Error('missing baseline row');
      expect(rec.score).toBeCloseTo(baselinePrior(row.winsE, row.gamesE, DEFAULT_CONFIG.k0), 12);
      expect(rec.reasons).toEqual([]);
      expect(rec.warnings ?? []).not.toContain('counteredBy:SUPPORT:200');
      expect((rec.warnings ?? []).some((w) => w.startsWith('counteredBy'))).toBe(false);
    }
    // Baseline order: champion 1 (30/50) ahead of champion 2 (28/50) — the
    // enemy-pair boost that flips them when enabled is gone.
    expect(result.recommendations.map((r) => r.championId)).toEqual([1, 2]);
  });

  it('keeps the deployed matchup behavior when enabled (default)', () => {
    const { data, input } = matchupFixture();
    const result = recommend(input, data);
    expect(result.recommendations.map((r) => r.championId)).toEqual([2, 1]);
    expect(
      result.recommendations.some((r) => r.reasons.some((reason) => reason.type === 'counter')),
    ).toBe(true);
  });

  it('disables comp and blind reasons too, not only pair terms', () => {
    // Champion 1 is bad into unseen ADC 201, champion 2 good: blind pick
    // produces `blind` reasons when enabled and none when disabled.
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 10 },
      { championId: 2, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 40 },
    ]);
    const data = makeData({ champions: [1, 2, 201], roleProb: BOT_ROLE_PROB, enemyPairs });
    const input = makeInput({ blindPick: true });
    const off = { ...DEFAULT_CONFIG, matchupEnabled: false };
    const offResult = recommend(input, data, off, DEFAULT_RECOMMEND_CONFIG);
    for (const rec of offResult.recommendations) {
      expect(rec.reasons).toEqual([]);
    }
    const on = recommend(input, data);
    expect(on.recommendations.some((r) => r.reasons.some((x) => x.type === 'blind'))).toBe(true);
  });
});

describe('recommend: matchupShrinkK partial pooling', () => {
  it('shrinks matchup terms toward zero as k grows', () => {
    const { data, input, baselines } = matchupFixture();
    const baselineIdx = indexBaselines(baselines, 'DIAMOND');
    const row = baselineIdx.get(2);
    if (!row) throw new Error('missing baseline');
    const p0 = baselinePrior(row.winsE, row.gamesE, DEFAULT_CONFIG.k0);

    // HIGH_GAMES gives n_eff ≈ 25000, so k must be on that scale to matter.
    const k0 = recommend(input, data, { ...DEFAULT_CONFIG, matchupShrinkK: 0 });
    const kBig = recommend(input, data, { ...DEFAULT_CONFIG, matchupShrinkK: 1e12 });
    const rec0 = k0.recommendations.find((r) => r.championId === 2);
    const recBig = kBig.recommendations.find((r) => r.championId === 2);
    if (!rec0 || !recBig) throw new Error('missing recommendation');

    // k -> infinity removes the matchup term: the score returns to p0.
    expect(recBig.score).toBeCloseTo(p0, 6);
    // Finite positive k shrinks strictly between the two.
    const kMid = recommend(input, data, { ...DEFAULT_CONFIG, matchupShrinkK: 10000 });
    const recMid = kMid.recommendations.find((r) => r.championId === 2);
    if (!recMid) throw new Error('missing recommendation');
    const dist = (s: number) => Math.abs(s - p0);
    expect(dist(recMid.score)).toBeLessThan(dist(rec0.score));
    expect(dist(recMid.score)).toBeGreaterThan(dist(recBig.score));
  });

  it('keeps the same candidate set and insufficientData as the enabled model', () => {
    const { data, input } = matchupFixture();
    const off = recommend(
      input,
      data,
      { ...DEFAULT_CONFIG, matchupEnabled: false },
      DEFAULT_RECOMMEND_CONFIG,
    );
    const on = recommend(input, data);
    const ids = (rs: typeof off.recommendations) =>
      rs.map((r) => r.championId).sort((a, b) => a - b);
    expect(ids(off.recommendations)).toEqual(ids(on.recommendations));
    expect(off.insufficientData).toEqual(on.insufficientData);
  });
});
