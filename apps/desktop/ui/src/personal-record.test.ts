import { describe, expect, it } from 'vitest';
import type { ProfileExport, Role } from '@draftorb/shared';
import { personalRecord } from './profile/personal-record';
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
