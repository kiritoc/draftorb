import { describe, expect, it } from 'vitest';

import { openDb, migrate } from './db';
import { ingestMatches } from './matches';
import { cursorKey } from './matches-store';
import { makeMatch, mockClient, PLATFORM, seedPlayer } from './matches.test-helpers';
import { RiotApiError } from './riot';

describe('participant match ingestion', () => {
  it('stores all ten extracted participants with the match', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    const match = makeMatch('EUW1_PARTICIPANTS');
    const client = mockClient({ 'p-alpha': ['EUW1_PARTICIPANTS'] }, { EUW1_PARTICIPANTS: match });

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.stored).toBe(1);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM participants WHERE match_id = ?')
        .get('EUW1_PARTICIPANTS'),
    ).toMatchObject({ count: 10 });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM participants WHERE match_id = ? AND win = 1')
        .get('EUW1_PARTICIPANTS'),
    ).toMatchObject({ count: 5 });
    db.close();
  });

  it('re-fetches a stored match with fewer than ten participants and completes it', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 7);
    db.prepare(
      `INSERT INTO matches (
        match_id, platform, patch, queue_id, duration, created_at, avg_rank_score, rank_known_count
      ) VALUES ('EUW1_INCOMPLETE', 'euw1', '16.21', 420, 1800, 1, 9, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO participants (
        match_id, puuid, team_id, champion_id, role, win, rank_score, champion_games,
        keystone, primary_style, sub_style, perks_json, items_json, kills, deaths, assists
      ) VALUES (
        'EUW1_INCOMPLETE', 'puuid-ally-support', 100, 412, 'SUPPORT', 1, 6.5, 0,
        8439, 8400, 8300, '{}', '[]', 2, 3, 18
      )`,
    ).run();

    const match = makeMatch('EUW1_INCOMPLETE', {
      participants: [{ puuid: 'p-beta' }],
    });
    const client = mockClient({ 'p-alpha': ['EUW1_INCOMPLETE'] }, { EUW1_INCOMPLETE: match });
    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.stored).toBe(1);
    expect(client.getMatch).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM participants WHERE match_id = ?')
        .get('EUW1_INCOMPLETE'),
    ).toMatchObject({ count: 10 });
    const repaired = db
      .prepare('SELECT avg_rank_score, rank_known_count FROM matches WHERE match_id = ?')
      .get('EUW1_INCOMPLETE') as { avg_rank_score: number; rank_known_count: number };
    expect(repaired.avg_rank_score).toBeCloseTo(6.75);
    expect(repaired.rank_known_count).toBe(2);
    db.close();
  });

  it('does not count metadata-only puuids in the stored rank summary', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    seedPlayer(db, 'p-beta', 9);
    const match = makeMatch('EUW1_META');
    match.metadata.participants = [...match.metadata.participants, 'p-beta'];
    const client = mockClient({ 'p-alpha': ['EUW1_META'] }, { EUW1_META: match });

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.stored).toBe(1);
    const row = db
      .prepare('SELECT avg_rank_score, rank_known_count FROM matches WHERE match_id = ?')
      .get('EUW1_META') as { avg_rank_score: number; rank_known_count: number };
    expect(row.avg_rank_score).toBe(6.5);
    expect(row.rank_known_count).toBe(1);
    db.close();
  });

  it('rolls back the match and cursor when a participant insert fails', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    db.exec(`
      CREATE TRIGGER fail_participant_insert
      BEFORE INSERT ON participants
      WHEN NEW.puuid = 'puuid-ally-support'
      BEGIN
        SELECT RAISE(FAIL, 'forced participant insert failure');
      END;
    `);
    const client = mockClient(
      { 'p-alpha': ['EUW1_ROLLBACK'] },
      { EUW1_ROLLBACK: makeMatch('EUW1_ROLLBACK') },
    );

    await expect(ingestMatches({ platform: PLATFORM, db, client })).rejects.toThrow(
      'forced participant insert failure',
    );
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM matches WHERE match_id = ?').get('EUW1_ROLLBACK'),
    ).toMatchObject({ count: 0 });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM ingest_state WHERE key = ?')
        .get(cursorKey(PLATFORM, 'p-alpha')),
    ).toMatchObject({ count: 0 });
    db.close();
  });

  it('rejects invalid role layouts without storing matches or participants', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    const match = makeMatch('EUW1_BAD_ROLES');
    const firstParticipant = match.info.participants[1];
    if (!firstParticipant) throw new Error('Fixture participant missing');
    match.info.participants[1] = { ...firstParticipant, teamPosition: 'MIDDLE' };
    const client = mockClient({ 'p-alpha': ['EUW1_BAD_ROLES'] }, { EUW1_BAD_ROLES: match });

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.invalid).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM matches WHERE match_id = ?').get('EUW1_BAD_ROLES'),
    ).toMatchObject({ count: 0 });
    expect(
      db.prepare('SELECT reason FROM match_rejects WHERE match_id = ?').get('EUW1_BAD_ROLES'),
    ).toMatchObject({ reason: 'invalid' });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM participants WHERE match_id = ?')
        .get('EUW1_BAD_ROLES'),
    ).toMatchObject({ count: 0 });
    db.close();
  });

  it('rejects persistent 404 match responses and continues to the next match', async () => {
    const db = openDb(':memory:');
    migrate(db);
    seedPlayer(db, 'p-alpha', 6.5);
    const client = mockClient(
      { 'p-alpha': ['EUW1_MISSING', 'EUW1_VALID'] },
      { EUW1_VALID: makeMatch('EUW1_VALID') },
    );
    client.getMatch.mockRejectedValueOnce(
      new RiotApiError(
        'Not found',
        404,
        'https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_MISSING',
      ),
    );

    const result = await ingestMatches({ platform: PLATFORM, db, client });

    expect(result.invalid).toBe(1);
    expect(result.stored).toBe(1);
    const cursor = db
      .prepare('SELECT value FROM ingest_state WHERE key = ?')
      .get(cursorKey(PLATFORM, 'p-alpha')) as { value: string };
    expect(JSON.parse(cursor.value)).toMatchObject({ status: 'done', processed: 2, invalid: 1 });
    expect(
      db.prepare('SELECT reason FROM match_rejects WHERE match_id = ?').get('EUW1_MISSING'),
    ).toMatchObject({ reason: 'invalid' });
    db.close();
  });
});
