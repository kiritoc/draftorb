import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { openDb, migrate } from './db';
import { extractChallenges } from './challenges';
import { runChallengesBackfill } from './challenges-backfill';
import { prepareMatchPersist, type StoredMatchRow } from './matches-persist';
import type { ParticipantRow } from './participants';
import { makeMatch, mockClient, PLATFORM } from './matches.test-helpers';
import { RiotApiError, type RiotClient } from './riot';

const CHALLENGES = {
  laningPhaseGoldExpAdvantage: 1234,
  earlyLaningPhaseGoldExpAdvantage: 500,
  maxCsAdvantageOnLaneOpponent: 12,
};

describe('extractChallenges', () => {
  it('extracts one row per participant with serialized challenges', () => {
    const match = makeMatch('EUW1_C1', {
      participants: [
        { challenges: CHALLENGES },
        { challenges: null },
        { challenges: 'not-an-object' },
      ],
    });
    const rows = extractChallenges(match, 'EUW1_C1');
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      match_id: 'EUW1_C1',
      challenges_json: JSON.stringify(CHALLENGES),
    });
    expect(rows[1]?.challenges_json).toBeNull();
    expect(rows[2]?.challenges_json).toBeNull();
    expect(rows[0]?.puuid).toBe(match.info.participants[0]?.puuid);
  });
});

function seedMatch(db: ReturnType<typeof openDb>, matchId: string): void {
  const match: StoredMatchRow = {
    match_id: matchId,
    platform: PLATFORM,
    patch: '16.21',
    queue_id: 420,
    duration: 1800,
    created_at: 1_760_000_000,
    avg_rank_score: 0,
    rank_known_count: 0,
  };
  const participants: ParticipantRow[] = Array.from({ length: 10 }, (_, index) => ({
    match_id: matchId,
    puuid: `puuid-${index}`,
    team_id: index < 5 ? 100 : 200,
    champion_id: 1,
    role: 'SUPPORT',
    win: index < 5 ? 1 : 0,
    rank_score: null,
    champion_games: 0,
    mastery_points: null,
    is_expert: null,
    keystone: 1,
    primary_style: 1,
    sub_style: 1,
    perks_json: '{}',
    items_json: '[]',
    kills: 0,
    deaths: 0,
    assists: 0,
  }));
  const stmts = prepareMatchPersist(db);
  db.transaction(() => {
    stmts.insertMatch.run(match);
    for (const participant of participants) {
      stmts.insertParticipant.run(participant);
    }
  })();
}

function challengeRows(db: ReturnType<typeof openDb>, matchId: string) {
  return db
    .prepare(
      'SELECT puuid, participant_id, challenges_json FROM participant_challenges WHERE match_id = ? ORDER BY puuid',
    )
    .all(matchId) as Array<{
    puuid: string;
    participant_id: number | null;
    challenges_json: string | null;
  }>;
}

function withDb(run: (db: ReturnType<typeof openDb>) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'draftorb-challenges-'));
  const db = openDb(join(dir, 'test.sqlite'));
  return (async () => {
    try {
      migrate(db);
      await run(db);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

describe('runChallengesBackfill', () => {
  it('writes challenges rows for pending matches and is a no-op on rerun', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const detail = makeMatch('m1', {
        participants: [{ challenges: CHALLENGES }],
      });
      // Align fixture puuids with the seeded participant puuids.
      detail.info.participants.forEach((participant, index) => {
        participant.puuid = `puuid-${index}`;
      });
      detail.metadata.participants = detail.info.participants.map((p) => p.puuid);
      const client = mockClient({}, { m1: detail });

      const first = await runChallengesBackfill({ db, client });
      expect(first.fetched).toBe(1);
      expect(first.rows).toBe(10);

      const rows = challengeRows(db, 'm1');
      expect(rows).toHaveLength(10);
      expect(rows[0]?.challenges_json).toBe(JSON.stringify(CHALLENGES));
      expect(rows[1]?.challenges_json).toBeNull();

      const second = await runChallengesBackfill({ db, client });
      expect(second.candidates).toBe(0);
      expect(client.getMatch).toHaveBeenCalledTimes(1);
    });
  });

  it('marks permanently unavailable match details with NULL rows', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      const client = {
        getMatch: vi.fn(async () => {
          throw new RiotApiError('not found', 404, 'https://example.test');
        }),
      } as unknown as RiotClient;

      const result = await runChallengesBackfill({ db, client });
      expect(result.fetched).toBe(0);
      expect(result.skipped).toBe(1);

      const rows = challengeRows(db, 'm1');
      expect(rows).toHaveLength(10);
      expect(rows.every((row) => row.challenges_json === null)).toBe(true);
      expect(rows.every((row) => row.participant_id === null)).toBe(true);

      const second = await runChallengesBackfill({ db, client });
      expect(second.candidates).toBe(0);
    });
  });

  it('respects the call budget and resumes on the next run', async () => {
    await withDb(async (db) => {
      seedMatch(db, 'm1');
      seedMatch(db, 'm2');
      const details = Object.fromEntries(
        ['m1', 'm2'].map((id) => {
          const detail = makeMatch(id, { participants: [{ challenges: CHALLENGES }] });
          detail.info.participants.forEach((participant, index) => {
            participant.puuid = `puuid-${index}`;
          });
          detail.metadata.participants = detail.info.participants.map((p) => p.puuid);
          return [id, detail];
        }),
      );
      const client = mockClient({}, details);

      const first = await runChallengesBackfill({ db, client, callBudget: 1 });
      expect(first.budgetExhausted).toBe(true);
      expect(first.fetched).toBe(1);

      const second = await runChallengesBackfill({ db, client });
      expect(second.fetched).toBe(1);
      expect(challengeRows(db, 'm1')).toHaveLength(10);
      expect(challengeRows(db, 'm2')).toHaveLength(10);
    });
  });
});
