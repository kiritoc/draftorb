import { readFileSync } from 'node:fs';

import { vi } from 'vitest';

import { openDb } from './db';
import { seedPatches } from './patches.test-helpers';
import { riotMatchDtoSchema, type Platform, type RiotClient, type RiotMatchDto } from './riot';

export const PLATFORM: Platform = 'euw1';

/** Fixture patch labels every ingestion test resolves through `patches` (D-043). */
export function seedMatchPatches(db: ReturnType<typeof openDb>): void {
  seedPatches(db, ['16.19', '16.20', '16.21', '16.22']);
}

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

function asParticipantOverride(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return value as Record<string, unknown>;
}

/** Clone the ranked fixture and overlay info fields; `participants` merge by index. */
export function makeMatch(matchId: string, over: Record<string, unknown> = {}): RiotMatchDto {
  const { participants: participantOverrides, ...infoOverrides } = over;
  const overrides = Array.isArray(participantOverrides)
    ? participantOverrides.map(asParticipantOverride)
    : [];
  const participants = matchFixture.info.participants.map((matchParticipant, index) => {
    const override = overrides[index];
    if (!override) return { ...matchParticipant };
    const puuid = typeof override.puuid === 'string' ? override.puuid : matchParticipant.puuid;
    return { ...matchParticipant, ...override, puuid };
  });

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
    getLeagueEntriesByPuuid: vi.fn(async () => []),
    getChampionMastery: vi.fn(async () => null),
  } as unknown as RiotClient & {
    getMatchIdsByPuuid: ReturnType<typeof vi.fn>;
    getMatch: ReturnType<typeof vi.fn>;
    getLeagueEntriesByPuuid: ReturnType<typeof vi.fn>;
    getChampionMastery: ReturnType<typeof vi.fn>;
  };
}
