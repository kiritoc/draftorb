/**
 * recommend(): manual bans (D-106, SPECS §2/§4/§5/§7.1).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ChampionId, DraftInput, RecommendData } from '@draftorb/shared';
import { recommend } from '../src/recommend.js';
import { buildCandidateSet } from '../src/recommend-pool.js';
import { blindOpponents } from '../src/recommend-terms.js';
import {
  BOT_ROLE_PROB,
  HIGH_GAMES,
  makeData,
  makeEnemyPairs,
  makeInput,
} from '../src/recommend-test-utils.js';

const ids = (recs: ReadonlyArray<{ championId: ChampionId }> | undefined): ChampionId[] =>
  (recs ?? []).map((r) => r.championId);

const fixture = JSON.parse(
  readFileSync(
    join(fileURLToPath(new URL('.', import.meta.url)), 'golden', 'full_draft_support.json'),
    'utf8',
  ),
) as { input: DraftInput; data: RecommendData };

describe('recommend: bans exclusion', () => {
  const data = makeData({ champions: [1, 2, 3, 4, 5, 6] });

  it('a banned champion never appears in recommendations, poolRecommendations or insufficientData', () => {
    const result = recommend(makeInput({ pool: [2, 3], bans: [2, 4] }), data);
    expect(ids(result.recommendations)).not.toContain(2);
    expect(ids(result.recommendations)).not.toContain(4);
    expect(ids(result.poolRecommendations)).not.toContain(2);
    expect(ids(result.poolRecommendations)).toEqual([3]);
    expect(ids(result.insufficientData)).not.toContain(2);
  });

  it('reports a banned pool champion as poolUnavailable with reason banned', () => {
    const result = recommend(makeInput({ pool: [2, 3], bans: [2] }), data);
    expect(result.poolUnavailable).toEqual([{ championId: 2, reason: 'banned' }]);
  });

  it('keeps unknownChampion for an unknown banned pool id', () => {
    const result = recommend(makeInput({ pool: [999], bans: [999] }), data);
    expect(result.poolUnavailable).toEqual([{ championId: 999, reason: 'unknownChampion' }]);
  });

  it('a champion both banned and picked is treated as picked without throwing', () => {
    const input = makeInput({
      allies: [{ championId: 2, role: 'ADC' }],
      pool: [2, 3],
      bans: [2],
    });
    const result = recommend(input, data);
    expect(result.poolUnavailable).toEqual([{ championId: 2, reason: 'picked' }]);
    const without = recommend({ ...input, bans: undefined } as DraftInput, data);
    expect(result).toEqual(without);
  });

  it('exposes the banned set (picked excluded) on the candidate set', () => {
    const input = makeInput({ allies: [{ championId: 2 }], bans: [2, 3] });
    const set = buildCandidateSet(input, data.championIds, data.roleProb);
    expect([...set.banned]).toEqual([3]);
    expect(set.candidates.has(3)).toBe(false);
  });
});

describe('recommend: bans and blind opponents', () => {
  it('blindOpponents honours an excluded set containing a banned champion', () => {
    const withBan = blindOpponents(['ADC'], new Set([201]), [1, 201, 202], BOT_ROLE_PROB);
    expect(withBan.get('ADC')?.map((o) => o.championId)).toEqual([202]);
  });

  it('a banned champion is not an unseen opponent in blind pick', () => {
    const enemyPairs = makeEnemyPairs([
      { championId: 1, enemyId: 201, role: 'ADC', ...HIGH_GAMES, winsW: 10 },
    ]);
    const blindData = makeData({ champions: [1, 201], roleProb: BOT_ROLE_PROB, enemyPairs });
    const blindOf = (r: ReturnType<typeof recommend>) =>
      r.recommendations[0]?.reasons.find((x) => x.type === 'blind');
    const open = recommend(makeInput({ blindPick: true }), blindData);
    const banned = recommend(makeInput({ blindPick: true, bans: [201] }), blindData);
    expect(blindOf(open)).toBeDefined();
    expect(blindOf(banned)).toBeUndefined();
    expect(banned.recommendations[0]?.score).not.toBe(open.recommendations[0]?.score);
  });
});

describe('recommend: bans regression on a non-blind full draft', () => {
  const base = recommend(fixture.input, fixture.data);
  const ban = ids(base.recommendations)[0] as ChampionId;
  const banned = recommend({ ...fixture.input, bans: [ban] }, fixture.data);

  it('removes only the banned champion', () => {
    expect(ids(banned.recommendations)).toEqual(ids(base.recommendations).filter((c) => c !== ban));
  });

  it('leaves score and reliability of unaffected champions identical', () => {
    for (const rec of banned.recommendations) {
      const before = base.recommendations.find((r) => r.championId === rec.championId);
      expect(before).toBeDefined();
      expect(rec.score).toBe(before?.score);
      expect(rec.reliability).toEqual(before?.reliability);
      expect(rec.reasons).toEqual(before?.reasons);
    }
    expect(banned.insufficientData).toEqual(base.insufficientData);
  });

  it('is deterministic', () => {
    const again = recommend({ ...fixture.input, bans: [ban] }, fixture.data);
    expect(again).toEqual(banned);
  });

  it('an empty bans array behaves like no bans', () => {
    expect(recommend({ ...fixture.input, bans: [] }, fixture.data)).toEqual(base);
  });
});
