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
  return personalStats(profile, championId, role).role;
}

export interface PersonalStats {
  /** All profile games on the champion, every role (BL-051). */
  readonly overall: PersonalRecord;
  /** Profile games on the champion in the drafted role (D-119). */
  readonly role: PersonalRecord;
}

function record(games: number, wins: number): PersonalRecord {
  return { games, wins, winRate: games >= RECORD_MIN_GAMES ? wins / games : null };
}

/** Personal record of a champion in a role plus across all roles (BL-051, D-119). */
export function personalStats(
  profile: ProfileExport,
  championId: number,
  role: Role,
): PersonalStats {
  let allGames = 0;
  let allWins = 0;
  let roleGames = 0;
  let roleWins = 0;
  for (const game of profile.games) {
    if (game.championId !== championId) continue;
    allGames += 1;
    if (game.win) allWins += 1;
    if (game.role === role) {
      roleGames += 1;
      if (game.win) roleWins += 1;
    }
  }
  return {
    overall: record(allGames, allWins),
    role: record(roleGames, roleWins),
  };
}
