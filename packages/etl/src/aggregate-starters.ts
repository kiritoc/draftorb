/**
 * @draftorb/etl — Starter-bundle aggregation by context (BL-031a, D-086
 * bundle half accepted via D-134).
 *
 * Reads the net starter bundles already stored per (match, participant) in
 * `participant_starters` by `aggregateItemBuilds` — the
 * `starterWindowSeconds` bundle definition with undo/sold/rebuy netting —
 * and aggregates them into `starter_ctx` along the owner-approved back-off
 * chain (D-086):
 *
 *   1. `lane:<slots>` — (champion, role, exact lane matchup), level 1
 *   2. `champion`     — (champion, role), level 2
 *   3. `role`         — role only (champion_id NULL), level 3
 *   4. `global`       — cross-role (champion_id and my_role NULL), level 4
 *
 * The lane level uses the same influence-sorted `contextSlots` key as
 * `item_build.lane_key`; the lane-archetype middle level of D-086 stays
 * PROPOSED under D-095 (M3) and is not implemented.
 *
 * Weighting matches rune/summoner aggregation: experts only (SPECS §3,
 * D-022), weight = recencyFactor * reliabilityFactor expanded over the
 * rank buckets by `expertWeight`, per-player capped and gated by the
 * D-102 evidence rule (`players >= evidenceMinDistinctPlayers`).
 *
 * The table is cleared and rewritten, so the command is idempotent. When
 * no starter contributes, `starter_ctx` is left untouched; contributions
 * that all fail the evidence gate still clear it.
 */

import type Database from 'better-sqlite3';

import type { RankBucket } from '@draftorb/shared';
import {
  DEFAULT_CONFIG,
  RANK_BUCKET_ORDER,
  bucketIndex,
  expertWeight,
  recencyFactor,
  reliabilityFactor,
  type RankWeightingConfig,
} from '@draftorb/engine';
import { lookupPatchIndex } from './patches';
import {
  accumulatePlayerWeighted,
  assertPatchFormat,
  finalizeEvidenceCounts,
  gameBucketIndex,
  groupRowsByMatch,
  loadPatchWindow,
  partitionByTeam,
  type EvidenceWeighted,
} from './aggregate-shared';
import { contextSlots, formatSlot, type MatchParticipant } from './aggregate-runes-context';

/** Back-off context levels for starter bundles (most specific = lowest). */
export const STARTER_CONTEXT_LEVELS = {
  lane: 1,
  champion: 2,
  role: 3,
  global: 4,
} as const;

export interface StarterCtxRow {
  championId: number | null;
  myRole: string | null;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  bundleKey: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  players: number;
}

export interface AggregateStartersOptions {
  config?: RankWeightingConfig;
  /** Snapshot patch: newer matches are excluded and recency is relative to it. */
  patch?: string;
  /** Called after `starter_ctx` is cleared and rewritten (including an empty rewrite). */
  onWrite?: () => void;
}

interface StarterAccum extends EvidenceWeighted {
  championId: number | null;
  myRole: string | null;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  bundleKey: string;
}

/** `lane:a.ROLE:id|e.ROLE:id` — same form as `item_build.lane_key`. */
function laneKeyOf(
  slots: ReadonlyArray<{ championId: number; side: 'a' | 'e'; role: string }>,
): string {
  if (slots.length === 0) return '';
  return `lane:${slots.map(formatSlot).join('|')}`;
}

interface StarterMatchRow {
  matchId: string;
  participantId: number;
  puuid: string;
  bundleKey: string;
}

interface MatchParticipantRow extends MatchParticipant {
  matchId: string;
  patch: string;
  rankKnownCount: number;
  rankScore: number;
}

/** Clears `starter_ctx` and rewrites it in one transaction (idempotent). */
function writeStarterCtxRows(db: Database.Database, rows: readonly StarterCtxRow[]): void {
  const clear = db.prepare('DELETE FROM starter_ctx');
  const insert = db.prepare(
    `INSERT INTO starter_ctx (
      champion_id, my_role, rank_bucket, context_key, context_level, bundle_key,
      wins_w, games_w, games_w2, players
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of rows) {
      insert.run(
        row.championId,
        row.myRole,
        row.rankBucket,
        row.contextKey,
        row.contextLevel,
        row.bundleKey,
        row.winsW,
        row.gamesW,
        row.gamesW2,
        row.players,
      );
    }
  });
  write.immediate();
}

export function aggregateStarterBundles(
  db: Database.Database,
  options: AggregateStartersOptions = {},
): StarterCtxRow[] {
  const config = options.config ?? DEFAULT_CONFIG;
  assertPatchFormat(options.patch);

  const snapshotPatch = options.patch;
  const { patchIndex, currentPatchIndex, snapshotIndex } = loadPatchWindow(db, snapshotPatch);

  // Experts must be judged within the patch window (D-022), same as runes.
  const futureGames = new Map<string, number>();
  if (snapshotPatch !== undefined) {
    const counts = db
      .prepare(
        `SELECT p.puuid AS puuid, p.champion_id AS championId, m.patch AS patch, COUNT(*) AS games
         FROM participants p
         JOIN matches m ON m.match_id = p.match_id
         GROUP BY p.puuid, p.champion_id, m.patch`,
      )
      .all() as Array<{ puuid: string; championId: number; patch: string; games: number }>;
    for (const c of counts) {
      const gameIndex = lookupPatchIndex(db, c.patch);
      if (gameIndex === undefined || snapshotIndex === undefined || gameIndex <= snapshotIndex) {
        continue;
      }
      const key = `${c.puuid}|${c.championId}`;
      futureGames.set(key, (futureGames.get(key) ?? 0) + c.games);
    }
  }

  const participantsStmt = db.prepare(
    `SELECT
       p.match_id AS matchId,
       p.champion_id AS championId,
       p.role AS role,
       p.win AS win,
       p.puuid AS puuid,
       p.team_id AS teamId,
       p.champion_games AS championGames,
       p.mastery_points AS masteryPoints,
       p.perks_json AS perksJson,
       m.patch AS patch,
       m.rank_known_count AS rankKnownCount,
       m.avg_rank_score AS rankScore
     FROM participants p
     JOIN matches m ON m.match_id = p.match_id
     WHERE p.match_id = ?
     ORDER BY p.match_id`,
  );

  const starterRows = db
    .prepare(
      `SELECT ps.match_id AS matchId, ps.participant_id AS participantId,
              ps.puuid AS puuid, ps.bundle_json AS bundleKey
       FROM participant_starters ps
       ORDER BY ps.match_id`,
    )
    .iterate() as IterableIterator<StarterMatchRow>;

  const accum = new Map<string, StarterAccum>();
  let sawContribution = false;

  const processMatch = (starters: StarterMatchRow[], participants: MatchParticipantRow[]): void => {
    const first = participants[0];
    if (first === undefined) return;
    const pIdx = patchIndex.get(first.patch);
    if (pIdx === undefined) return;

    const baseW =
      recencyFactor(pIdx, currentPatchIndex, config.decay) *
      reliabilityFactor(first.rankKnownCount, config.unknownRankFactor);
    if (baseW <= 0) return;

    const gameBucketIdx = gameBucketIndex(first.rankScore);
    const bucketWeights: Array<{ rankBucket: RankBucket; w: number }> = [];
    for (const rankBucket of RANK_BUCKET_ORDER) {
      const w =
        baseW * expertWeight(gameBucketIdx, bucketIndex(rankBucket), config.alpha, config.wMax);
      if (w > 0) bucketWeights.push({ rankBucket, w });
    }
    if (bucketWeights.length === 0) return;

    const teams = partitionByTeam(participants);
    const byPuuid = new Map(participants.map((p) => [p.puuid, p]));

    for (const starter of starters) {
      const me = byPuuid.get(starter.puuid);
      if (me === undefined || starter.bundleKey === '') continue;

      const windowGames = me.championGames - (futureGames.get(`${me.puuid}|${me.championId}`) ?? 0);
      const masteryExpert =
        me.masteryPoints !== null && me.masteryPoints >= config.minMasteryPoints;
      if (windowGames < config.minChampGames && !masteryExpert) continue;

      const myTeam = teams.get(me.teamId);
      if (myTeam === undefined) continue;
      const allies = myTeam.filter((p) => p.puuid !== me.puuid);
      const enemies = [...teams.values()].filter((t) => t !== myTeam).flat();

      const slots = contextSlots(me, allies, enemies, config);
      const laneKey = laneKeyOf(slots);

      // Back-off chain (D-086 bundle half): exact lane -> champion -> role
      // -> global. champion_id/my_role are NULL on the broader fallbacks.
      const contexts: Array<{
        contextKey: string;
        contextLevel: number;
        championId: number | null;
        myRole: string | null;
      }> = [];
      if (laneKey !== '') {
        contexts.push({
          contextKey: laneKey,
          contextLevel: STARTER_CONTEXT_LEVELS.lane,
          championId: me.championId,
          myRole: me.role,
        });
      }
      contexts.push(
        {
          contextKey: 'champion',
          contextLevel: STARTER_CONTEXT_LEVELS.champion,
          championId: me.championId,
          myRole: me.role,
        },
        {
          contextKey: 'role',
          contextLevel: STARTER_CONTEXT_LEVELS.role,
          championId: null,
          myRole: me.role,
        },
        {
          contextKey: 'global',
          contextLevel: STARTER_CONTEXT_LEVELS.global,
          championId: null,
          myRole: null,
        },
      );

      for (const { rankBucket, w } of bucketWeights) {
        for (const ctx of contexts) {
          // NULLs cannot appear in the string key: use sentinels.
          const key =
            `${ctx.championId ?? -1}|${ctx.myRole ?? ''}|${rankBucket}|` +
            `${ctx.contextKey}|${starter.bundleKey}`;
          accumulatePlayerWeighted(accum, key, me.puuid, w, me.win, () => ({
            championId: ctx.championId,
            myRole: ctx.myRole,
            rankBucket,
            contextKey: ctx.contextKey,
            contextLevel: ctx.contextLevel,
            bundleKey: starter.bundleKey,
            winsW: 0,
            gamesW: 0,
            gamesW2: 0,
            playerWeights: new Map(),
          }));
          sawContribution = true;
        }
      }
    }
  };

  for (const group of groupRowsByMatch(starterRows)) {
    const matchId = group[0]?.matchId;
    if (matchId === undefined) continue;
    const participants = participantsStmt.all(matchId) as MatchParticipantRow[];
    if (participants.length === 0) continue;
    if (!patchIndex.has(participants[0]?.patch ?? '')) continue;
    processMatch(group, participants);
  }

  const result: StarterCtxRow[] = [];
  for (const entry of accum.values()) {
    const counts = finalizeEvidenceCounts(entry, config.evidencePlayerWeightCap);
    if (counts.players < config.evidenceMinDistinctPlayers) continue;
    result.push({
      championId: entry.championId,
      myRole: entry.myRole,
      rankBucket: entry.rankBucket,
      contextKey: entry.contextKey,
      contextLevel: entry.contextLevel,
      bundleKey: entry.bundleKey,
      winsW: counts.winsW,
      gamesW: counts.gamesW,
      gamesW2: counts.gamesW2,
      players: counts.players,
    });
  }

  // No contributing games: leave existing rows unchanged (same as runes).
  // Contributing games suppressed by the evidence rule still clear the table.
  if (result.length === 0 && !sawContribution) return result;

  writeStarterCtxRows(db, result);
  options.onWrite?.();

  return result;
}
