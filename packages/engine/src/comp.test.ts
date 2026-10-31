/**
 * Unit tests for the comp need calculation (T-023).
 */

import { describe, it, expect } from 'vitest';
import { computeCompNeed, teamMissingNeeds } from './comp.js';
import { DEFAULT_COMP_CONFIG } from './config.js';
import type { ChampionId, ChampionTags, ChampionTagsMap } from '@draftorb/shared';

function makeTags(entries: Record<number, Partial<ChampionTags>>): ChampionTagsMap {
  const result: ChampionTagsMap = {};
  for (const [idStr, partial] of Object.entries(entries)) {
    const id = Number(idStr) as ChampionId;
    result[String(id)] = {
      championId: id,
      damageType: partial?.damageType ?? 'MIXED',
      archetype: partial?.archetype ?? 'fighter',
      hardEngage: partial?.hardEngage ?? false,
      peel: partial?.peel ?? false,
      poke: partial?.poke ?? false,
      waveclear: partial?.waveclear ?? false,
      scaling: partial?.scaling ?? { early: false, mid: true, late: true },
      range: partial?.range ?? 'MELEE',
      ccCount: partial?.ccCount ?? 0,
    } as ChampionTags;
  }
  return result;
}

describe('teamMissingNeeds', () => {
  it('detects missing engage when no ally has hardEngage', () => {
    const tags = makeTags({ 1: { hardEngage: false }, 2: { hardEngage: false } });
    const missing = teamMissingNeeds([1, 2], tags);
    expect(missing.has('engage')).toBe(true);
  });

  it('detects present engage when an ally has hardEngage', () => {
    const tags = makeTags({ 1: { hardEngage: true }, 2: { hardEngage: false } });
    const missing = teamMissingNeeds([1, 2], tags);
    expect(missing.has('engage')).toBe(false);
  });

  it('reports no missing needs when no ally has tags', () => {
    const tags = makeTags({ 5: { hardEngage: true } });
    expect(teamMissingNeeds([1, 2], tags).size).toBe(0);
    expect(computeCompNeed(5, [1, 2], tags).bonus).toBe(0);
  });

  it('ignores untagged allies for the damage-mix ally count', () => {
    const tags = makeTags({ 1: { damageType: 'AD' }, 2: { damageType: 'AD' } });
    const missing = teamMissingNeeds([1, 2, 99], tags);
    expect(missing.has('ap_damage')).toBe(false);
  });

  it('does not check damage mix with fewer than 3 allies', () => {
    const tags = makeTags({
      1: { damageType: 'AD' },
      2: { damageType: 'AD' },
    });
    const missing = teamMissingNeeds([1, 2], tags);
    expect(missing.has('ad_damage')).toBe(false);
    expect(missing.has('ap_damage')).toBe(false);
  });

  it('detects missing AP damage when all allies are AD', () => {
    const tags = makeTags({
      1: { damageType: 'AD' },
      2: { damageType: 'AD' },
      3: { damageType: 'AD' },
    });
    const missing = teamMissingNeeds([1, 2, 3], tags);
    expect(missing.has('ad_damage')).toBe(false);
    expect(missing.has('ap_damage')).toBe(true);
  });

  it('detects missing AD damage when all allies are AP', () => {
    const tags = makeTags({
      1: { damageType: 'AP' },
      2: { damageType: 'AP' },
      3: { damageType: 'AP' },
    });
    const missing = teamMissingNeeds([1, 2, 3], tags);
    expect(missing.has('ad_damage')).toBe(true);
    expect(missing.has('ap_damage')).toBe(false);
  });

  it('detects no damage need when mix is sufficient', () => {
    const tags = makeTags({
      1: { damageType: 'AD' },
      2: { damageType: 'AP' },
      3: { damageType: 'MIXED' },
    });
    const missing = teamMissingNeeds([1, 2, 3], tags);
    expect(missing.has('ad_damage')).toBe(false);
    expect(missing.has('ap_damage')).toBe(false);
  });

  it('reports no missing needs when no ally is known', () => {
    const tags = makeTags({ 1: { hardEngage: true } });
    expect(teamMissingNeeds([], tags).size).toBe(0);
    expect(computeCompNeed(1, [], tags).bonus).toBe(0);
  });

  it('skips champions without tags gracefully', () => {
    const tags = makeTags({ 1: { hardEngage: true } });
    const missing = teamMissingNeeds([1, 2, 99], tags);
    expect(missing.has('engage')).toBe(false);
    expect(missing.has('peel')).toBe(true);
  });
});

describe('computeCompNeed', () => {
  it('returns bonus for filling missing engage', () => {
    const tags = makeTags({ 1: { hardEngage: true, peel: false, poke: false, waveclear: false } });
    const result = computeCompNeed(1, [2], tags);
    expect(result.filled).toContain('engage');
    expect(result.bonus).toBeCloseTo(DEFAULT_COMP_CONFIG.engage, 10);
    expect(result.reasons).toContain('engage');
  });

  it('returns zero bonus when no needs are missing', () => {
    const tags = makeTags({
      1: { hardEngage: true, peel: true, poke: true, waveclear: true, damageType: 'AD' },
      2: { hardEngage: true, peel: true, poke: true, waveclear: true, damageType: 'AP' },
      3: { hardEngage: true, peel: true, poke: true, waveclear: true, damageType: 'AD' },
    });
    const result = computeCompNeed(1, [2, 3], tags);
    expect(result.bonus).toBe(0);
    expect(result.filled).toHaveLength(0);
  });

  it('returns zero bonus when champion has no tags', () => {
    const tags = makeTags({ 1: { hardEngage: true } });
    const result = computeCompNeed(99, [1], tags);
    expect(result.bonus).toBe(0);
    expect(result.filled).toHaveLength(0);
  });

  it('fills multiple needs', () => {
    const tags = makeTags({
      1: {
        hardEngage: true,
        peel: true,
        poke: true,
        waveclear: true,
        damageType: 'MIXED',
      },
      2: { hardEngage: false, peel: false, poke: false, waveclear: false, damageType: 'AD' },
      3: { hardEngage: false, peel: false, poke: false, waveclear: false, damageType: 'AD' },
      4: { hardEngage: false, peel: false, poke: false, waveclear: false, damageType: 'AD' },
    });
    const result = computeCompNeed(1, [2, 3, 4], tags);
    expect(result.filled).toContain('engage');
    expect(result.filled).toContain('peel');
    expect(result.filled).toContain('waveclear');
    expect(result.filled).toContain('poke');
    expect(result.filled).toContain('ap_damage'); // MIXED provides AP too
  });

  it('bonus is additive across filled needs', () => {
    const tags = makeTags({
      1: { hardEngage: true, peel: true, waveclear: true, poke: true, damageType: 'MIXED' },
      2: { hardEngage: false, peel: false, waveclear: false, poke: false, damageType: 'AD' },
      3: { hardEngage: false, peel: false, waveclear: false, poke: false, damageType: 'AD' },
      4: { hardEngage: false, peel: false, waveclear: false, poke: false, damageType: 'AD' },
    });
    const result = computeCompNeed(1, [2, 3, 4], tags);
    const expected =
      DEFAULT_COMP_CONFIG.engage +
      DEFAULT_COMP_CONFIG.peel +
      DEFAULT_COMP_CONFIG.waveclear +
      DEFAULT_COMP_CONFIG.poke +
      DEFAULT_COMP_CONFIG.apDamage;
    expect(result.bonus).toBeCloseTo(expected, 10);
  });

  it('respects custom config thresholds', () => {
    const tags = makeTags({
      1: { hardEngage: true, damageType: 'MIXED' },
      2: { hardEngage: true, damageType: 'AD' },
      3: { hardEngage: true, damageType: 'AD' },
      4: { hardEngage: true, damageType: 'AD' },
    });
    const config = { ...DEFAULT_COMP_CONFIG, missingThreshold: 0.9 };
    const result = computeCompNeed(1, [2, 3, 4], tags, config);
    // With high threshold, 1 AD out of 3 (0.33 < 0.9) should detect missing AP
    expect(result.filled).toContain('ap_damage');
  });
});
