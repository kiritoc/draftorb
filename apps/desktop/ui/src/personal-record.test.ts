import { describe, expect, it } from 'vitest';
import type { ProfileExport, Role } from '@draftorb/shared';
import { personalRecord, personalStats } from './profile/personal-record';
import { makeProfile } from './profile/test-fixtures';

const profile = (games: ReadonlyArray<readonly [number, Role, boolean]>): ProfileExport =>
  makeProfile(games.map(([championId, role, win]) => ({ championId, role, win })));

describe('personalRecord', () => {
  it('counts only the champion in the drafted role', () => {
    const p = profile([
      [1, 'SUPPORT', true],
      [1, 'SUPPORT', false],
      [1, 'TOP', true],
      [2, 'SUPPORT', true],
    ]);
    expect(personalRecord(p, 1, 'SUPPORT')).toEqual({ games: 2, wins: 1, winRate: null });
    expect(personalRecord(p, 1, 'TOP')).toEqual({ games: 1, wins: 1, winRate: null });
  });

  it('hides the rate below 5 games and shows it from 5', () => {
    const four = profile(Array.from({ length: 4 }, () => [1, 'SUPPORT', true] as const));
    expect(personalRecord(four, 1, 'SUPPORT').winRate).toBeNull();
    const five = profile([
      ...Array.from({ length: 3 }, () => [1, 'SUPPORT', true] as const),
      ...Array.from({ length: 2 }, () => [1, 'SUPPORT', false] as const),
    ]);
    expect(personalRecord(five, 1, 'SUPPORT')).toEqual({ games: 5, wins: 3, winRate: 0.6 });
  });

  it('handles zero games', () => {
    expect(personalRecord(profile([]), 1, 'SUPPORT')).toEqual({ games: 0, wins: 0, winRate: null });
  });
});

describe('personalStats (BL-051)', () => {
  it('counts every role in overall and only the drafted role in role', () => {
    const p = profile([
      [1, 'SUPPORT', true],
      [1, 'SUPPORT', false],
      [1, 'TOP', true],
      [1, 'JUNGLE', false],
      [1, 'ADC', true],
      [2, 'TOP', true],
    ]);
    const stats = personalStats(p, 1, 'SUPPORT');
    expect(stats.overall).toEqual({ games: 5, wins: 3, winRate: 0.6 });
    expect(stats.role).toEqual({ games: 2, wins: 1, winRate: null });
    expect(personalStats(p, 1, 'TOP').role).toEqual({ games: 1, wins: 1, winRate: null });
  });

  it('applies the 5-game threshold to both scopes independently', () => {
    const games: Array<readonly [number, Role, boolean]> = [
      ...Array.from({ length: 3 }, () => [1, 'SUPPORT', true] as const),
      ...Array.from({ length: 2 }, () => [1, 'SUPPORT', false] as const),
      [1, 'TOP', true],
      [1, 'TOP', true],
    ];
    const stats = personalStats(profile(games), 1, 'SUPPORT');
    // Role scope: 5 games -> rate shown; overall: 7 games -> rate shown.
    expect(stats.role.winRate).toBeCloseTo(0.6);
    expect(stats.overall.winRate).toBeCloseTo(5 / 7);
  });

  it('overall can reach the threshold while the role scope cannot', () => {
    const games: Array<readonly [number, Role, boolean]> = [
      [1, 'SUPPORT', true],
      [1, 'TOP', true],
      [1, 'JUNGLE', true],
      [1, 'ADC', true],
      [1, 'MID', true],
    ];
    const stats = personalStats(profile(games), 1, 'SUPPORT');
    expect(stats.overall).toEqual({ games: 5, wins: 5, winRate: 1 });
    expect(stats.role).toEqual({ games: 1, wins: 1, winRate: null });
  });
});
