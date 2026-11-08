import type Database from 'better-sqlite3';
import type { Role } from '@draftorb/shared';
import { DEFAULT_CONFIG } from '@draftorb/engine';

import { playerRankScore } from './players';
import { rankSummary, createRankLoader, updateMatchRankStats } from './matches-store';
import type { ParticipantRow } from './participants';
import type { Platform, RiotChampionMastery, RiotClient } from './riot';

const BOT_LANE_ROLES: ReadonlySet<Role> = new Set(['ADC', 'SUPPORT']);

export interface EnrichmentOptions {
  db: Database.Database;
  client: RiotClient;
  platform: Platform;
  minChampGames?: number;
  myRole: Role;
  seedPuuid: string;
  seedRankScore: number;
  onProgress?: (msg: string) => void;
}

export interface EnrichmentSummary {
  ranksFetched: number;
  ranksCached: number;
  ranksUnranked: number;
  masteryFetched: number;
  masteryCached: number;
  masteryNotFound: number;
  failures: number;
}

const INITIAL_SUMMARY: EnrichmentSummary = {
  ranksFetched: 0,
  ranksCached: 0,
  ranksUnranked: 0,
  masteryFetched: 0,
  masteryCached: 0,
  masteryNotFound: 0,
  failures: 0,
};

interface EnrichmentStatements {
  playerExists: Database.Statement;
  upsertPlayer: Database.Statement;
  countChampionGames: Database.Statement;
  findExistingMastery: Database.Statement;
  getCurrentMastery: Database.Statement;
  updateParticipantEnrichment: Database.Statement;
  updateChampionGamesAll: Database.Statement;
  updateParticipantRank: Database.Statement;
}

function prepareStatements(db: Database.Database): EnrichmentStatements {
  return {
    playerExists: db.prepare('SELECT 1 FROM players WHERE puuid = ?'),
    upsertPlayer: db.prepare(`
      INSERT INTO players (puuid, platform, tier, division, lp, rank_score, updated_at)
      VALUES (@puuid, @platform, @tier, @division, @lp, @rank_score, @updated_at)
      ON CONFLICT(puuid) DO UPDATE SET
        tier = excluded.tier,
        division = excluded.division,
        lp = excluded.lp,
        rank_score = excluded.rank_score,
        updated_at = excluded.updated_at
    `),
    countChampionGames: db.prepare(
      'SELECT COUNT(*) AS count FROM participants WHERE puuid = ? AND champion_id = ?',
    ),
    findExistingMastery: db.prepare(
      'SELECT mastery_points FROM participants WHERE puuid = ? AND champion_id = ? AND mastery_points IS NOT NULL LIMIT 1',
    ),
    getCurrentMastery: db.prepare(
      'SELECT mastery_points FROM participants WHERE match_id = ? AND puuid = ?',
    ),
    updateParticipantEnrichment: db.prepare(`
      UPDATE participants
      SET champion_games = @champion_games,
          mastery_points = CASE WHEN @set_mastery = 1 THEN @mastery_points ELSE mastery_points END
      WHERE match_id = @match_id AND puuid = @puuid
    `),
    updateChampionGamesAll: db.prepare(
      'UPDATE participants SET champion_games = ? WHERE puuid = ? AND champion_id = ?',
    ),
    updateParticipantRank: db.prepare(
      'UPDATE participants SET rank_score = ? WHERE match_id = ? AND puuid = ?',
    ),
  };
}

async function enrichBotLaneRanks(
  matchId: string,
  participants: ParticipantRow[],
  stmts: EnrichmentStatements,
  seedPuuid: string,
  platform: Platform,
  client: RiotClient,
  onProgress?: (msg: string) => void,
): Promise<Pick<EnrichmentSummary, 'ranksFetched' | 'ranksCached' | 'ranksUnranked' | 'failures'>> {
  const result = { ranksFetched: 0, ranksCached: 0, ranksUnranked: 0, failures: 0 };
  const botLane = participants.filter((p) => BOT_LANE_ROLES.has(p.role));

  for (const participant of botLane) {
    if (participant.puuid === seedPuuid) {
      result.ranksCached += 1;
      continue;
    }

    const cached = stmts.playerExists.get(participant.puuid);
    if (cached) {
      result.ranksCached += 1;
      continue;
    }

    try {
      const entries = await client.getLeagueEntriesByPuuid(platform, participant.puuid);
      const soloEntry = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5');

      if (soloEntry) {
        const rankScore = playerRankScore(soloEntry.tier, soloEntry.rank);
        stmts.upsertPlayer.run({
          puuid: participant.puuid,
          platform,
          tier: soloEntry.tier,
          division: soloEntry.rank,
          lp: soloEntry.leaguePoints,
          rank_score: rankScore,
          updated_at: Date.now(),
        });
        stmts.updateParticipantRank.run(rankScore, matchId, participant.puuid);
        result.ranksFetched += 1;
      } else {
        stmts.upsertPlayer.run({
          puuid: participant.puuid,
          platform,
          tier: null,
          division: null,
          lp: 0,
          rank_score: null,
          updated_at: Date.now(),
        });
        stmts.updateParticipantRank.run(null, matchId, participant.puuid);
        result.ranksUnranked += 1;
        result.ranksFetched += 1;
      }
    } catch (err) {
      result.failures += 1;
      onProgress?.(
        `rank fetch failed (role ${participant.role}, champion ${participant.champion_id}): ${String(err)}`,
      );
    }
  }

  return result;
}

async function enrichMasteryForParticipants(
  matchId: string,
  participants: ParticipantRow[],
  stmts: EnrichmentStatements,
  minChampGames: number,
  myRole: Role,
  platform: Platform,
  client: RiotClient,
  onProgress?: (msg: string) => void,
): Promise<
  Pick<EnrichmentSummary, 'masteryFetched' | 'masteryCached' | 'masteryNotFound' | 'failures'>
> {
  const result = { masteryFetched: 0, masteryCached: 0, masteryNotFound: 0, failures: 0 };

  for (const participant of participants) {
    const championGames = (
      stmts.countChampionGames.get(participant.puuid, participant.champion_id) as { count: number }
    ).count;

    const currentMasteryRow = stmts.getCurrentMastery.get(matchId, participant.puuid) as
      { mastery_points: number | null } | undefined;
    const currentMastery = currentMasteryRow?.mastery_points ?? null;

    let masteryPoints: number | null = currentMastery;
    let setMastery = 0;

    if (participant.role === myRole && championGames < minChampGames && currentMastery === null) {
      const existing = stmts.findExistingMastery.get(participant.puuid, participant.champion_id) as
        { mastery_points: number | null } | undefined;

      if (existing?.mastery_points !== null && existing?.mastery_points !== undefined) {
        masteryPoints = existing.mastery_points;
        setMastery = 1;
        result.masteryCached += 1;
      } else {
        try {
          const mastery: RiotChampionMastery | null = await client.getChampionMastery(
            platform,
            participant.puuid,
            participant.champion_id,
          );
          if (mastery) {
            masteryPoints = mastery.championPoints;
            result.masteryFetched += 1;
          } else {
            masteryPoints = 0;
            result.masteryNotFound += 1;
          }
          setMastery = 1;
        } catch (err) {
          result.failures += 1;
          onProgress?.(
            `mastery fetch failed for champion ${participant.champion_id}: ${String(err)}`,
          );
        }
      }
    }

    stmts.updateParticipantEnrichment.run({
      match_id: matchId,
      puuid: participant.puuid,
      champion_games: championGames,
      mastery_points: masteryPoints,
      set_mastery: setMastery,
    });
  }

  const seenPairs = new Set<string>();
  for (const participant of participants) {
    const pairKey = `${participant.puuid}:${participant.champion_id}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const refreshedCount = (
      stmts.countChampionGames.get(participant.puuid, participant.champion_id) as { count: number }
    ).count;
    stmts.updateChampionGamesAll.run(refreshedCount, participant.puuid, participant.champion_id);
  }

  return result;
}

export async function enrichParticipants(
  matchId: string,
  participants: ParticipantRow[],
  options: EnrichmentOptions,
): Promise<EnrichmentSummary> {
  const {
    db,
    client,
    platform,
    minChampGames = DEFAULT_CONFIG.minChampGames,
    myRole,
    seedPuuid,
    seedRankScore,
    onProgress,
  } = options;

  const stmts = prepareStatements(db);
  const summary: EnrichmentSummary = { ...INITIAL_SUMMARY };

  const rankResult = await enrichBotLaneRanks(
    matchId,
    participants,
    stmts,
    seedPuuid,
    platform,
    client,
    onProgress,
  );
  summary.ranksFetched = rankResult.ranksFetched;
  summary.ranksCached = rankResult.ranksCached;
  summary.ranksUnranked = rankResult.ranksUnranked;
  summary.failures += rankResult.failures;

  const loadRanks = createRankLoader(db);
  const participantPuuids = participants.map((p) => p.puuid);
  const ranksByPuuid = loadRanks(participantPuuids);
  const rank = rankSummary(ranksByPuuid, participantPuuids, seedPuuid, seedRankScore);
  updateMatchRankStats(db, matchId, rank.avg, rank.known);

  const masteryResult = await enrichMasteryForParticipants(
    matchId,
    participants,
    stmts,
    minChampGames,
    myRole,
    platform,
    client,
    onProgress,
  );
  summary.masteryFetched = masteryResult.masteryFetched;
  summary.masteryCached = masteryResult.masteryCached;
  summary.masteryNotFound = masteryResult.masteryNotFound;
  summary.failures += masteryResult.failures;

  return summary;
}
