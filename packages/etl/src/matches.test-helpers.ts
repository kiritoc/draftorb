import { readFileSync } from 'node:fs';

import { vi } from 'vitest';

import { openDb } from './db';
import { riotMatchDtoSchema, type Platform, type RiotClient, type RiotMatchDto } from './riot';

export const PLATFORM: Platform = 'euw1';

const matchFixture = riotMatchDtoSchema.parse(
  JSON.parse(
    readFileSync(new URL('../test/fixtures/match.json', import.meta.url), 'utf8'),
  ) as unknown,
);

export function seedPlayer(db: ReturnType<typeof openDb>, puuid: string, rankScore: number): void {
  db.prepare(
    `INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
     VALUES (?, 'euw1', 'DIAMOND', 'II', 50, ?, 0)`,
  ).run(puuid, rankScore);
}

export function participant(puuid: string): Record<string, unknown> {
  return {
    puuid,
    teamId: 100,
    championId: 412,
    teamPosition: 'UTILITY',
    win: true,
    kills: 1,
    deaths: 2,
    assists: 10,
  };
}

export function makeMatch(matchId: string, over: Record<string, unknown> = {}): RiotMatchDto {
  const { participants: participantOverrides, ...infoOverrides } = over;
  const overridePuuids = Array.isArray(participantOverrides)
    ? participantOverrides.map((value) => {
        if (typeof value !== 'object' || value === null || !('puuid' in value)) return undefined;
        return typeof value.puuid === 'string' ? value.puuid : undefined;
      })
    : [];
  const participants = matchFixture.info.participants.map((matchParticipant, index) => ({
    ...matchParticipant,
    puuid: overridePuuids[index] ?? matchParticipant.puuid,
  }));

  return {
    metadata: {
      ...matchFixture.metadata,
      matchId,
      participants: participants.map((matchParticipant) => matchParticipant.puuid),
    },
    info: {
      ...matchFixture.info,
      gameCreation: 1_760_000_000_000,
      gameDuration: 1800,
      gameVersion: '16.21.1.42',
      ...infoOverrides,
      participants,
    },
  };
}

export function mockClient(ids: Record<string, string[]>, matches: Record<string, unknown>) {
  return {
    getMatchIdsByPuuid: vi.fn(async (_platform: Platform, puuid: string) => ids[puuid] ?? []),
    getMatch: vi.fn(async (_platform: Platform, matchId: string) => matches[matchId]),
  } as unknown as RiotClient & {
    getMatchIdsByPuuid: ReturnType<typeof vi.fn>;
    getMatch: ReturnType<typeof vi.fn>;
  };
}
