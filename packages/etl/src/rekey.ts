/**
 * @draftorb/etl — PUUID re-keying.
 *
 * Riot encrypts PUUIDs per API key: a puuid fetched with one key cannot be
 * decrypted by another (match-v5 / league-v4 by-puuid endpoints return
 * "400 Exception decrypting"). When the RIOT_API_KEY changes, every puuid
 * stored in the database becomes unusable while match IDs stay valid.
 *
 * This pass re-fetches every stored match by match ID (key-independent) and
 * pairs each stored participant row with the same participant in the fresh
 * payload via a stat fingerprint (team, champion, kills, deaths, assists),
 * producing an old-puuid -> new-puuid map. The map is then applied to
 * `participants`, `players` and the `match-ingest:` cursors in `ingest_state`.
 */

import type Database from 'better-sqlite3';

import type { Platform, RiotClient, RiotParticipantDto } from './riot';

export interface RekeyOptions {
  /** Restrict to matches of one platform (matches.platform value). */
  platform?: Platform;
  /** Build the mapping and report, but write nothing. */
  dryRun?: boolean;
  /** Stop after this many matches (testing). */
  limit?: number;
  log?: (message: string) => void;
}

export interface RekeyStats {
  matchesScanned: number;
  matchesFailed: number;
  participantsRekeyed: number;
  playersRenamed: number;
  playersMerged: number;
  playersDeleted: number;
  cursorsRenamed: number;
  cursorsDeleted: number;
  /** Participant rows whose puuid never appeared in a successfully scanned match. */
  staleParticipants: number;
}

export interface StoredParticipantRef {
  puuid: string;
  team_id: number;
  champion_id: number;
  kills: number;
  deaths: number;
  assists: number;
}

const MATCH_INGEST_PREFIX = 'match-ingest:';

function fingerprint(
  teamId: number,
  championId: number,
  kills: number,
  deaths: number,
  assists: number,
): string {
  return `${teamId}:${championId}:${kills}:${deaths}:${assists}`;
}

function storedFingerprint(row: StoredParticipantRef): string {
  return fingerprint(row.team_id, row.champion_id, row.kills, row.deaths, row.assists);
}

function apiFingerprint(participant: RiotParticipantDto): string {
  return fingerprint(
    participant.teamId,
    participant.championId,
    participant.kills,
    participant.deaths,
    participant.assists,
  );
}

/**
 * Pairs stored participant rows with fresh API participants of the same match.
 * Returns null when the match cannot be paired unambiguously.
 */
export function planMatchPairs(
  stored: readonly StoredParticipantRef[],
  apiParticipants: readonly RiotParticipantDto[],
): Array<{ oldPuuid: string; newPuuid: string }> | null {
  if (stored.length !== apiParticipants.length) return null;

  const oldByFp = new Map<string, string>();
  for (const row of stored) {
    const fp = storedFingerprint(row);
    if (oldByFp.has(fp)) return null;
    oldByFp.set(fp, row.puuid);
  }

  const pairs: Array<{ oldPuuid: string; newPuuid: string }> = [];
  const seen = new Set<string>();
  for (const participant of apiParticipants) {
    const fp = apiFingerprint(participant);
    if (seen.has(fp)) return null;
    seen.add(fp);
    const oldPuuid = oldByFp.get(fp);
    if (oldPuuid === undefined) return null;
    pairs.push({ oldPuuid, newPuuid: participant.puuid });
  }

  return pairs;
}

function cursorPuuid(key: string): string | null {
  if (!key.startsWith(MATCH_INGEST_PREFIX)) return null;
  const rest = key.slice(MATCH_INGEST_PREFIX.length);
  const secondColon = rest.indexOf(':');
  if (secondColon === -1) return null;
  const puuid = rest.slice(secondColon + 1);
  return puuid.length > 0 ? puuid : null;
}

/**
 * Re-fetches every stored match and rewrites puuid references to the current
 * API key's encryption. Idempotent: a second run maps current puuids onto
 * themselves.
 */
export async function rekeyPuuids(
  db: Database.Database,
  client: RiotClient,
  options: RekeyOptions = {},
): Promise<RekeyStats> {
  const log = options.log ?? (() => undefined);
  const stats: RekeyStats = {
    matchesScanned: 0,
    matchesFailed: 0,
    participantsRekeyed: 0,
    playersRenamed: 0,
    playersMerged: 0,
    playersDeleted: 0,
    cursorsRenamed: 0,
    cursorsDeleted: 0,
    staleParticipants: 0,
  };

  const matchRows = db
    .prepare('SELECT match_id, platform FROM matches ORDER BY match_id')
    .all() as Array<{ match_id: string; platform: string }>;
  const scoped =
    options.platform !== undefined
      ? matchRows.filter((row) => row.platform === options.platform)
      : matchRows;
  const targets = options.limit !== undefined ? scoped.slice(0, options.limit) : scoped;

  const storedStmt = db.prepare(
    `SELECT puuid, team_id, champion_id, kills, deaths, assists
     FROM participants WHERE match_id = ?`,
  );

  // old puuid -> new puuid, plus per-match pairs for the participants update.
  const mapping = new Map<string, string>();
  const conflicts: string[] = [];
  const matchPairs = new Map<string, Array<{ oldPuuid: string; newPuuid: string }>>();

  let processed = 0;
  for (const row of targets) {
    processed += 1;
    if (processed % 100 === 0) {
      log(`Scanned ${processed}/${targets.length} matches...`);
    }
    try {
      const match = await client.getMatch(row.platform as Platform, row.match_id);
      const stored = storedStmt.all(row.match_id) as StoredParticipantRef[];
      const pairs = planMatchPairs(stored, match.info.participants);
      if (pairs === null) {
        stats.matchesFailed += 1;
        // Match IDs and puuids are never logged: workflow logs are public.
        log(
          `Rekey: skipping match ${processed}/${targets.length} — participant set does not match stored rows`,
        );
        continue;
      }
      stats.matchesScanned += 1;
      matchPairs.set(row.match_id, pairs);
      for (const pair of pairs) {
        const existing = mapping.get(pair.oldPuuid);
        if (existing !== undefined && existing !== pair.newPuuid) {
          conflicts.push(`conflicting mapping at match ordinal ${processed}`);
        } else {
          mapping.set(pair.oldPuuid, pair.newPuuid);
        }
      }
    } catch (error) {
      stats.matchesFailed += 1;
      log(
        `Rekey: match ${processed}/${targets.length} fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Rekey aborted: ${conflicts.length} conflicting puuid mapping(s). First: ${conflicts[0]}`,
    );
  }

  const newPuuids = new Set(mapping.values());

  if (options.dryRun) {
    log(
      `Dry run: ${mapping.size} puuid mapping(s) from ${stats.matchesScanned} match(es); ` +
        `${stats.matchesFailed} match(es) failed.`,
    );
    return stats;
  }

  const apply = db.transaction(() => {
    const updateParticipant = db.prepare(
      'UPDATE participants SET puuid = ? WHERE match_id = ? AND puuid = ?',
    );
    const updateItemEvent = db.prepare(
      'UPDATE item_events SET puuid = ? WHERE match_id = ? AND puuid = ?',
    );
    for (const [matchId, pairs] of matchPairs) {
      for (const pair of pairs) {
        if (pair.oldPuuid === pair.newPuuid) continue;
        if (updateParticipant.run(pair.newPuuid, matchId, pair.oldPuuid).changes > 0) {
          stats.participantsRekeyed += 1;
        }
        updateItemEvent.run(pair.newPuuid, matchId, pair.oldPuuid);
      }
    }

    const playerRows = db.prepare('SELECT puuid FROM players').all() as Array<{
      puuid: string;
    }>;
    const newPuuidExists = db.prepare('SELECT 1 FROM players WHERE puuid = ?');
    const renamePlayer = db.prepare('UPDATE players SET puuid = ? WHERE puuid = ?');
    const deletePlayer = db.prepare('DELETE FROM players WHERE puuid = ?');
    for (const { puuid } of playerRows) {
      const mapped = mapping.get(puuid);
      if (mapped === undefined || mapped === puuid) continue;
      if (newPuuidExists.get(mapped) !== undefined) {
        deletePlayer.run(puuid);
        stats.playersMerged += 1;
      } else {
        renamePlayer.run(mapped, puuid);
        stats.playersRenamed += 1;
      }
    }

    // After renames, any players row outside the new puuid space is stale
    // (encrypted under a previous key) and unusable: every by-puuid call
    // would fail. They are re-created by the next `etl players` run.
    const deleteStalePlayer = db.prepare('DELETE FROM players WHERE puuid = ?');
    for (const { puuid } of db.prepare('SELECT puuid FROM players').all() as Array<{
      puuid: string;
    }>) {
      if (!newPuuids.has(puuid)) {
        deleteStalePlayer.run(puuid);
        stats.playersDeleted += 1;
      }
    }

    const cursorRows = db
      .prepare("SELECT key FROM ingest_state WHERE key LIKE 'match-ingest:%'")
      .all() as Array<{ key: string }>;
    const cursorValue = db.prepare('SELECT value FROM ingest_state WHERE key = ?');
    const deleteCursor = db.prepare('DELETE FROM ingest_state WHERE key = ?');
    const renameCursor = (oldKey: string, newKey: string): void => {
      const value = cursorValue.get(oldKey) as { value: string } | undefined;
      if (value === undefined) return;
      db.prepare('INSERT OR REPLACE INTO ingest_state (key, value) VALUES (?, ?)').run(
        newKey,
        value.value,
      );
      deleteCursor.run(oldKey);
    };
    for (const { key } of cursorRows) {
      const puuid = cursorPuuid(key);
      if (puuid === null) continue;
      const platform = key.slice(
        MATCH_INGEST_PREFIX.length,
        key.indexOf(':', MATCH_INGEST_PREFIX.length),
      );
      const mapped = mapping.get(puuid);
      if (mapped !== undefined && mapped !== puuid) {
        const newKey = `${MATCH_INGEST_PREFIX}${platform}:${mapped}`;
        const existing = cursorValue.get(newKey);
        if (existing !== undefined) {
          deleteCursor.run(key);
        } else {
          renameCursor(key, newKey);
          stats.cursorsRenamed += 1;
        }
      } else if (mapped === undefined && !newPuuids.has(puuid)) {
        // Cursor for a puuid that no stored match references: unusable under
        // the current key, drop it so the player is re-ingested as new.
        deleteCursor.run(key);
        stats.cursorsDeleted += 1;
      }
    }
  });
  apply();

  const participantPuuids = db.prepare('SELECT DISTINCT puuid FROM participants').all() as Array<{
    puuid: string;
  }>;
  stats.staleParticipants = participantPuuids.filter((row) => !newPuuids.has(row.puuid)).length;

  log(
    `Rekey done: ${stats.participantsRekeyed} participant row(s), ` +
      `${stats.playersRenamed} player(s) renamed, ${stats.playersMerged} merged, ` +
      `${stats.playersDeleted} stale player(s) deleted, ` +
      `${stats.cursorsRenamed} cursor(s) renamed, ${stats.cursorsDeleted} deleted ` +
      `(${stats.matchesScanned} match(es) scanned, ${stats.matchesFailed} failed, ` +
      `${mapping.size} puuid mapping(s)).`,
  );
  return stats;
}
