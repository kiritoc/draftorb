/**
 * @draftorb/etl — Summoner-spell-pair aggregation by context (BL-031a).
 *
 * Computes `summoner_ctx` rows per (champion, my_role, context_key,
 * spell_pair) using the same experts rule, recency/reliability weighting and
 * rank-bucket expansion as rune aggregation (SPECS §3/§8.1, D-021/D-022/
 * D-102). The context chain is identical to `rune_ctx`: the influence-sorted
 * lane slots (dropping the least influential one at each step), then the
 * enemy damage mix, then `global`.
 *
 * The spell pair is the unordered normalized `"minId:maxId"` key (SPECS
 * §18.5). Participants whose match predates the summoner-spell backfill
 * (`summoner1_id`/`summoner2_id` NULL) contribute nothing.
 *
 * The table is cleared and rewritten, so the command is idempotent. When no
 * participant contributes, `summoner_ctx` is left untouched; contributions
 * that all fail the evidence gate still clear it.
 */

import type Database from 'better-sqlite3';
import { join } from 'node:path';

import { RUNE_CONTEXT_LEVELS, type RankBucket } from '@draftorb/shared';
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
import { defaultManualDataDir } from './config/paths';
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
import {
  contextSlots,
  damageMix,
  formatSlot,
  loadChampionTags,
  type MatchParticipant,
} from './aggregate-runes-context';

/** Normalized unordered spell-pair key `"minId:maxId"` (SPECS §18.5). */
export function spellPairKey(summoner1Id: number, summoner2Id: number): string {
  return summoner1Id <= summoner2Id
    ? `${summoner1Id}:${summoner2Id}`
    : `${summoner2Id}:${summoner1Id}`;
}

export interface SummonerCtxRow {
  championId: number;
  myRole: string;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  spellPair: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  players: number;
}

export interface AggregateSummonersOptions {
  config?: RankWeightingConfig;
  /** Snapshot patch: newer matches are excluded and recency is relative to it. */
  patch?: string;
  /** Champion tags file for the damage-mix context; defaults to data/manual/champion-tags.json. */
  tagsPath?: string;
  /** Called after `summoner_ctx` is cleared and rewritten (including an empty rewrite). */
  onWrite?: () => void;
}

interface SummonerAccum extends EvidenceWeighted {
  championId: number;
  myRole: string;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  spellPair: string;
}

interface MatchParticipantRow extends MatchParticipant {
  matchId: string;
  patch: string;
  rankKnownCount: number;
  rankScore: number;
  summoner1Id: number | null;
  summoner2Id: number | null;
}

/** Clears `summoner_ctx` and rewrites it in one transaction (idempotent). */
function writeSummonerCtxRows(db: Database.Database, rows: readonly SummonerCtxRow[]): void {
  const clear = db.prepare('DELETE FROM summoner_ctx');
  const insert = db.prepare(
    `INSERT INTO summoner_ctx (
      champion_id, my_role, rank_bucket, context_key, context_level, spell_pair,
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
        row.spellPair,
        row.winsW,
        row.gamesW,
        row.gamesW2,
        row.players,
      );
    }
  });
  write.immediate();
}

export function aggregateSummonersByContext(
  db: Database.Database,
  options: AggregateSummonersOptions = {},
): SummonerCtxRow[] {
  const config = options.config ?? DEFAULT_CONFIG;
  assertPatchFormat(options.patch);

  const snapshotPatch = options.patch;
  const { patchIndex, currentPatchIndex, snapshotIndex } = loadPatchWindow(db, snapshotPatch);

  const tags = loadChampionTags(
    options.tagsPath ?? join(defaultManualDataDir(), 'champion-tags.json'),
  );

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

  // Key: `${championId}|${myRole}|${contextKey}|${spellPair}` (rank bucket is
  // expanded inside the loop like rune aggregation).
  const accum = new Map<string, SummonerAccum>();
  let sawContribution = false;

  const rows = db
    .prepare(
      `SELECT
         p.match_id AS matchId,
         p.champion_id AS championId,
         p.role AS role,
         p.win AS win,
         p.puuid AS puuid,
         p.team_id AS teamId,
         p.champion_games AS championGames,
         p.mastery_points AS masteryPoints,
         p.summoner1_id AS summoner1Id,
         p.summoner2_id AS summoner2Id,
         m.patch AS patch,
         m.rank_known_count AS rankKnownCount,
         m.avg_rank_score AS rankScore
       FROM participants p
       JOIN matches m ON m.match_id = p.match_id
       ORDER BY p.match_id`,
    )
    .iterate() as IterableIterator<MatchParticipantRow>;

  const processMatch = (group: MatchParticipantRow[]): void => {
    const first = group[0];
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

    const teams = partitionByTeam(group);

    for (const me of group) {
      if (me.summoner1Id === null || me.summoner2Id === null) continue;
      const pair = spellPairKey(me.summoner1Id, me.summoner2Id);

      const windowGames = me.championGames - (futureGames.get(`${me.puuid}|${me.championId}`) ?? 0);
      const masteryExpert =
        me.masteryPoints !== null && me.masteryPoints >= config.minMasteryPoints;
      if (windowGames < config.minChampGames && !masteryExpert) continue;

      const myTeam = teams.get(me.teamId);
      if (myTeam === undefined) continue;
      const allies = myTeam.filter((p) => p.puuid !== me.puuid);
      const enemies = [...teams.values()].filter((t) => t !== myTeam).flat();

      const slots = contextSlots(me, allies, enemies, config);
      const enemyChampIds = enemies.map((e) => e.championId);
      const mix = damageMix(enemyChampIds, tags);

      // Same back-off chain as rune_ctx (SPECS §8.1): lane slots dropping the
      // least influential first, then damage mix, then global.
      const contexts: Array<{ contextKey: string; contextLevel: number }> = [];
      for (let n = slots.length; n >= 1; n--) {
        contexts.push({
          contextKey: `lane:${slots.slice(0, n).map(formatSlot).join(',')}`,
          contextLevel: Math.max(RUNE_CONTEXT_LEVELS.laneBase, RUNE_CONTEXT_LEVELS.damageMix - n),
        });
      }
      contexts.push(
        { contextKey: `damagemix:${mix}`, contextLevel: RUNE_CONTEXT_LEVELS.damageMix },
        { contextKey: 'global', contextLevel: RUNE_CONTEXT_LEVELS.global },
      );

      const targets = bucketWeights.flatMap(({ rankBucket, w }) =>
        contexts.map((ctx) => ({ rankBucket, w, ctx })),
      );
      for (const { rankBucket, w, ctx } of targets) {
        const key = `${me.championId}|${me.role}|${rankBucket}|${ctx.contextKey}|${pair}`;
        accumulatePlayerWeighted(accum, key, me.puuid, w, me.win, () => ({
          championId: me.championId,
          myRole: me.role,
          rankBucket,
          contextKey: ctx.contextKey,
          contextLevel: ctx.contextLevel,
          spellPair: pair,
          winsW: 0,
          gamesW: 0,
          gamesW2: 0,
          playerWeights: new Map(),
        }));
        sawContribution = true;
      }
    }
  };

  for (const group of groupRowsByMatch(rows)) {
    if (group[0] !== undefined && !patchIndex.has(group[0].patch)) continue;
    processMatch(group);
  }

  const result: SummonerCtxRow[] = [];
  for (const entry of accum.values()) {
    const counts = finalizeEvidenceCounts(entry, config.evidencePlayerWeightCap);
    if (counts.players < config.evidenceMinDistinctPlayers) continue;
    result.push({
      championId: entry.championId,
      myRole: entry.myRole,
      rankBucket: entry.rankBucket,
      contextKey: entry.contextKey,
      contextLevel: entry.contextLevel,
      spellPair: entry.spellPair,
      winsW: counts.winsW,
      gamesW: counts.gamesW,
      gamesW2: counts.gamesW2,
      players: counts.players,
    });
  }

  // No contributing games: leave existing rows unchanged (same as runes).
  // Contributing games suppressed by the evidence rule still clear the table.
  if (result.length === 0 && !sawContribution) return result;

  writeSummonerCtxRows(db, result);
  options.onWrite?.();

  return result;
}
