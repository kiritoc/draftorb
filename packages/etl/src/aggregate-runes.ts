/**
 * @draftorb/etl — Rune aggregation by context (role-generic).
 *
 * Computes `rune_ctx` rows per (champion, my_role, context_key, perks_hash)
 * using the engine rank kernel for recency/reliability weighting (SPECS §3 /
 * D-021) and the experts rule (SPECS §3 / D-022): only participants with
 * `champion_games >= minChampGames` in our own data count as experts.
 *
 * Each expert participant's rune page contributes to three back-off context
 * levels (most specific first, SPECS §8.1):
 *  1. `lane:<ctx champ ids>`   — top `contextSlots` lane-context champions,
 *                                ordered by descending lane-phase influence
 *                                (ties: ally before enemy, then role order).
 *  2. `damagemix:<AD|AP|mixed>` — enemy-team damage mix from champion tags.
 *  3. `global`                 — champion-global, no context.
 *
 * Weight per contributing game = recencyFactor * reliabilityFactor. Weighted
 * counts (`wins_w`, `games_w`, `games_w2`) and distinct player counts
 * (`players`) are accumulated per row.
 *
 * The table is cleared and rewritten, so the command is idempotent. When no
 * participant contributes, `rune_ctx` is left untouched.
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
import { comparePatches } from './matches-store';
import { defaultManualDataDir } from './config/paths';
import {
  accumulateWeighted,
  assertPatchFormat,
  gameBucketIndex,
  groupRowsByMatch,
  loadPatchWindow,
  partitionByTeam,
} from './aggregate-shared';
import {
  canonicalPerksJson,
  contextSlots,
  damageMix,
  formatSlot,
  loadChampionTags,
  perksHash,
  type MatchParticipant,
} from './aggregate-runes-context';

export { canonicalPerksJson, damageMix } from './aggregate-runes-context';
export type { MatchParticipant } from './aggregate-runes-context';

export interface RuneCtxRow {
  championId: number;
  myRole: string;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  perksHash: string;
  perksJson: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  players: number;
}

export interface AggregateRunesOptions {
  config?: RankWeightingConfig;
  /** Snapshot patch: newer matches are excluded and recency is relative to it. */
  patch?: string;
  /** Champion tags file for the damage-mix context; defaults to data/manual/champion-tags.json. */
  tagsPath?: string;
}

interface RuneAccum {
  championId: number;
  myRole: string;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  perksHash: string;
  perksJson: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  puuids: Set<string>;
}

interface MatchParticipantRow extends MatchParticipant {
  matchId: string;
  patch: string;
  rankKnownCount: number;
  rankScore: number;
}

/** Clears `rune_ctx` and rewrites it in one transaction (idempotent). */
function writeRuneCtxRows(db: Database.Database, result: RuneCtxRow[]): void {
  const clear = db.prepare('DELETE FROM rune_ctx');
  const insert = db.prepare(
    `INSERT INTO rune_ctx (
      champion_id, my_role, rank_bucket, context_key, context_level, perks_hash, perks_json,
      wins_w, games_w, games_w2, players
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of result) {
      insert.run(
        row.championId,
        row.myRole,
        row.rankBucket,
        row.contextKey,
        row.contextLevel,
        row.perksHash,
        row.perksJson,
        row.winsW,
        row.gamesW,
        row.gamesW2,
        row.players,
      );
    }
  });
  write.immediate();
}

export function aggregateRunesByContext(
  db: Database.Database,
  options: AggregateRunesOptions = {},
): RuneCtxRow[] {
  const config = options.config ?? DEFAULT_CONFIG;
  assertPatchFormat(options.patch);

  const snapshotPatch = options.patch;
  const { patchIndex, currentPatchIndex } = loadPatchWindow(db, snapshotPatch);

  const tags = loadChampionTags(
    options.tagsPath ?? join(defaultManualDataDir(), 'champion-tags.json'),
  );

  // Experts must be judged within the patch window (D-022): `champion_games`
  // counts the whole DB, so subtract games newer than the snapshot.
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
      if (comparePatches(c.patch, snapshotPatch) <= 0) continue;
      const key = `${c.puuid}|${c.championId}`;
      futureGames.set(key, (futureGames.get(key) ?? 0) + c.games);
    }
  }

  // Key: `${championId}|${myRole}|${contextKey}|${perksHash}`
  const accum = new Map<string, RuneAccum>();

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
         p.perks_json AS perksJson,
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
    // expertWeight per user bucket (SPECS §3): 0 below the user bucket, bonus above.
    const bucketWeights: Array<{ rankBucket: RankBucket; w: number }> = [];
    for (const rankBucket of RANK_BUCKET_ORDER) {
      const w =
        baseW * expertWeight(gameBucketIdx, bucketIndex(rankBucket), config.alpha, config.wMax);
      if (w > 0) bucketWeights.push({ rankBucket, w });
    }
    if (bucketWeights.length === 0) return;

    const teams = partitionByTeam(group);

    for (const me of group) {
      const windowGames = me.championGames - (futureGames.get(`${me.puuid}|${me.championId}`) ?? 0);
      // Experts rule (SPECS §3, D-022): enough in-window games, or the mastery
      // fallback. Enrichment only fetches mastery for participants of the
      // recommended role, so the fallback is role-limited by construction.
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
      const canonical = canonicalPerksJson(me.perksJson);
      const phash = perksHash(canonical);

      // Lane back-off (SPECS §8.1): drop the least-influential slot each step.
      // Context level increases as specificity decreases (more slots = lower level).
      const contexts: Array<{ contextKey: string; contextLevel: number }> = [];
      for (let n = slots.length; n >= 1; n--) {
        contexts.push({
          contextKey: `lane:${slots.slice(0, n).map(formatSlot).join(',')}`,
          // Fixed 3-slot hierarchy: level depends only on n (3=1, 2=2, 1=3), so
          // one-slot keys from TOP or partial lanes match one-slot back-offs.
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
        const key = `${me.championId}|${me.role}|${rankBucket}|${ctx.contextKey}|${phash}`;
        accumulateWeighted(accum, key, w, me.win, () => ({
          championId: me.championId,
          myRole: me.role,
          rankBucket,
          contextKey: ctx.contextKey,
          contextLevel: ctx.contextLevel,
          perksHash: phash,
          perksJson: canonical,
          winsW: 0,
          gamesW: 0,
          gamesW2: 0,
          puuids: new Set<string>(),
        })).puuids.add(me.puuid);
      }
    }
  };

  for (const group of groupRowsByMatch(rows)) {
    if (group[0] !== undefined && !patchIndex.has(group[0].patch)) continue;
    processMatch(group);
  }

  const result: RuneCtxRow[] = [];
  for (const entry of accum.values()) {
    result.push({
      championId: entry.championId,
      myRole: entry.myRole,
      rankBucket: entry.rankBucket,
      contextKey: entry.contextKey,
      contextLevel: entry.contextLevel,
      perksHash: entry.perksHash,
      perksJson: entry.perksJson,
      winsW: entry.winsW,
      gamesW: entry.gamesW,
      gamesW2: entry.gamesW2,
      players: entry.puuids.size,
    });
  }

  // No contributing games: leave existing rows unchanged (same as baseline / pairs).
  if (result.length === 0) return result;

  writeRuneCtxRows(db, result);

  return result;
}
