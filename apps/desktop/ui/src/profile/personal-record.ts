import type { ProfileExport, Role } from '@draftorb/shared';
import { RECORD_MIN_GAMES } from '../config';

export interface PersonalRecord {
  games: number;
  wins: number;
  /** Raw wins / games, only from RECORD_MIN_GAMES games (D-119). */
  winRate: number | null;
}

export function personalRecord(
  profile: ProfileExport,
  championId: number,
  role: Role,
): PersonalRecord {
  let games = 0;
  let wins = 0;
  for (const game of profile.games) {
    if (game.championId !== championId || game.role !== role) continue;
    games += 1;
    if (game.win) wins += 1;
  }
  return { games, wins, winRate: games >= RECORD_MIN_GAMES ? wins / games : null };
}
