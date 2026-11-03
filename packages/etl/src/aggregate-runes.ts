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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RUNE_CONTEXT_LEVELS,
  championTagsMapSchema,
  type ChampionTagsMap,
  type RankBucket,
  type Role,
} from '@draftorb/shared';
import {
  DEFAULT_CONFIG,
  DEFAULT_LANE_GROUPS,
  RANK_BUCKET_ORDER,
  bucketIndex,
  expertWeight,
  getInfluence,
  recencyFactor,
  reliabilityFactor,
  type RankWeightingConfig,
} from '@draftorb/engine';
import { PATCH_PATTERN } from './aggregate';
import { comparePatches } from './matches-store';
import { defaultManualDataDir } from './config/paths';

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

// Back-off context levels (most specific = lowest number, SPECS §8.1).
// Lane contexts increment as slots are dropped (3-slot → 2-slot → 1-slot).
const ROLE_ORDER: readonly string[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

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

interface MatchParticipant {
  championId: number;
  role: string;
  win: number;
  puuid: string;
  teamId: number;
  championGames: number;
  masteryPoints: number | null;
  perksJson: string;
}

interface LaneSlot {
  championId: number;
  side: 'a' | 'e';
  role: string;
}

/**
 * Canonical damage mix of a team's champions. Untagged champions carry no
 * signal and are ignored; with no tagged champion at all the mix is `mixed`.
 */
export function damageMix(championIds: number[], tags: Map<number, string>): 'AD' | 'AP' | 'mixed' {
  let hasAd = false;
  let hasAp = false;
  for (const id of championIds) {
    const dmg = tags.get(id);
    if (dmg === 'AD') hasAd = true;
    else if (dmg === 'AP') hasAp = true;
    else if (dmg === 'MIXED') {
      // Explicit hybrid / true-damage tags count for both sides.
      hasAd = true;
      hasAp = true;
    }
    // 'NONE' contributes no damage signal and is ignored.
  }
  if (hasAd && !hasAp) return 'AD';
  if (hasAp && !hasAd) return 'AP';
  return 'mixed';
}

interface RiotPerksLike {
  statPerks?: { defense?: number; flex?: number; offense?: number };
  styles?: Array<{
    description?: string;
    style?: number;
    selections?: Array<{ perk?: number }>;
  }>;
}

/**
 * Canonical rune page: keeps only selected style / perk / shard ids and drops
 * match-specific `var1..var3` statistics, so identical pages share one hash.
 * Non Riot-shaped JSON is returned unchanged.
 */
export function canonicalPerksJson(perksJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(perksJson);
  } catch {
    return perksJson;
  }
  if (typeof parsed !== 'object' || parsed === null) return perksJson;
  const perks = parsed as RiotPerksLike;
  if (!Array.isArray(perks.styles)) return perksJson;
  const stat = perks.statPerks ?? {};
  return JSON.stringify({
    statPerks: {
      defense: stat.defense ?? null,
      flex: stat.flex ?? null,
      offense: stat.offense ?? null,
    },
    styles: perks.styles.map((s) => ({
      description: s.description ?? null,
      style: s.style ?? null,
      selections: (s.selections ?? []).map((sel) => ({ perk: sel.perk ?? null })),
    })),
  });
}

function formatSlot(slot: LaneSlot): string {
  return `${slot.side}.${slot.role}:${slot.championId}`;
}

function loadChampionTags(tagsPath: string): Map<number, string> {
  // A missing or invalid tags file must fail loudly (B-047): silently using an
  // empty map would degrade every damage mix to `mixed`.
  let raw: ChampionTagsMap;
  try {
    raw = championTagsMapSchema.parse(JSON.parse(readFileSync(tagsPath, 'utf8')));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load champion tags from ${tagsPath}: ${reason}`);
  }
  const tags = new Map<number, string>();
  for (const [key, tag] of Object.entries(raw)) {
    const id = Number(key);
    if (Number.isFinite(id) && tag?.damageType) {
      tags.set(id, tag.damageType);
    }
  }
  return tags;
}

function perksHash(perksJson: string): string {
  return createHash('sha256').update(perksJson).digest('hex');
}

/** Top `contextSlots` lane-context champions for `myRole`, by lane influence. */
function contextSlots(
  me: MatchParticipant,
  allies: MatchParticipant[],
  enemies: MatchParticipant[],
  config: RankWeightingConfig,
): LaneSlot[] {
  const laneGroup = DEFAULT_LANE_GROUPS[me.role as Role];
  if (laneGroup === undefined) return [];
  const candidates: Array<{
    championId: number;
    role: string;
    influence: number;
    side: number;
    roleOrder: number;
  }> = [];

  for (const role of laneGroup.allies) {
    const ally = allies.find((p) => p.role === role);
    if (!ally) continue;
    candidates.push({
      championId: ally.championId,
      role,
      influence: getInfluence(me.role as Role, 'ally', role, 'lane', config),
      side: 0,
      roleOrder: ROLE_ORDER.indexOf(role),
    });
  }
  for (const role of laneGroup.enemies) {
    const enemy = enemies.find((p) => p.role === role);
    if (!enemy) continue;
    candidates.push({
      championId: enemy.championId,
      role,
      influence: getInfluence(me.role as Role, 'enemy', role, 'lane', config),
      side: 1,
      roleOrder: ROLE_ORDER.indexOf(role),
    });
  }

  candidates.sort((a, b) => {
    if (b.influence !== a.influence) return b.influence - a.influence;
    if (a.side !== b.side) return a.side - b.side; // ally (0) before enemy (1)
    return a.roleOrder - b.roleOrder;
  });

  // Keep influence order (most influential first) and side/role in the key so
  // swapped ally/enemy matchups never share a row.
  return candidates.slice(0, config.contextSlots).map((c) => ({
    championId: c.championId,
    side: c.side === 0 ? 'a' : 'e',
    role: c.role,
  }));
}

export function aggregateRunesByContext(
  db: Database.Database,
  options: AggregateRunesOptions = {},
): RuneCtxRow[] {
  const config = options.config ?? DEFAULT_CONFIG;
  if (options.patch !== undefined && !PATCH_PATTERN.test(options.patch)) {
    throw new Error(`Invalid patch "${options.patch}". Expected a format like "16.21".`);
  }

  const snapshotPatch = options.patch;

  const storedPatches = (
    db.prepare('SELECT DISTINCT patch FROM matches').all() as Array<{ patch: string }>
  )
    .map((row) => row.patch)
    .filter((patch) => snapshotPatch === undefined || comparePatches(patch, snapshotPatch) <= 0);
  const patchSet = new Set(storedPatches);
  if (snapshotPatch !== undefined && patchSet.size > 0) patchSet.add(snapshotPatch);
  const patches = [...patchSet].sort(comparePatches);
  const patchIndex = new Map<string, number>();
  patches.forEach((patch, i) => {
    patchIndex.set(patch, i);
  });
  const currentPatchIndex = patches.length - 1;

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
    .iterate() as IterableIterator<{
    matchId: string;
    championId: number;
    role: string;
    win: number;
    puuid: string;
    teamId: number;
    championGames: number;
    masteryPoints: number | null;
    perksJson: string;
    patch: string;
    rankKnownCount: number;
    rankScore: number;
  }>;

  const maxBucket = RANK_BUCKET_ORDER.length - 1;

  // Group participants by match so lane context (needs all participants of a
  // match) can be resolved one match at a time.
  let current:
    | {
        matchId: string;
        patch: string;
        rankKnownCount: number;
        rankScore: number;
        participants: MatchParticipant[];
      }
    | undefined;

  const processMatch = (match: {
    patch: string;
    rankKnownCount: number;
    rankScore: number;
    participants: MatchParticipant[];
  }): void => {
    const pIdx = patchIndex.get(match.patch);
    if (pIdx === undefined) return;

    const baseW =
      recencyFactor(pIdx, currentPatchIndex, config.decay) *
      reliabilityFactor(match.rankKnownCount, config.unknownRankFactor);
    if (baseW <= 0) return;

    // rank_score scale: integer part = RANK_BUCKET_ORDER index (6.5 = DIAMOND).
    const gameBucketIdx = Math.max(0, Math.min(Math.floor(match.rankScore), maxBucket));
    // expertWeight per user bucket (SPECS §3): 0 below the user bucket, bonus above.
    const bucketWeights: Array<{ rankBucket: RankBucket; w: number }> = [];
    for (const rankBucket of RANK_BUCKET_ORDER) {
      const w =
        baseW * expertWeight(gameBucketIdx, bucketIndex(rankBucket), config.alpha, config.wMax);
      if (w > 0) bucketWeights.push({ rankBucket, w });
    }
    if (bucketWeights.length === 0) return;

    const teams = new Map<number, MatchParticipant[]>();
    for (const p of match.participants) {
      const team = teams.get(p.teamId);
      if (team === undefined) {
        teams.set(p.teamId, [p]);
      } else {
        team.push(p);
      }
    }

    for (const me of match.participants) {
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
        const existing = accum.get(key);
        if (existing === undefined) {
          accum.set(key, {
            championId: me.championId,
            myRole: me.role,
            rankBucket,
            contextKey: ctx.contextKey,
            contextLevel: ctx.contextLevel,
            perksHash: phash,
            perksJson: canonical,
            winsW: w * me.win,
            gamesW: w,
            gamesW2: w * w,
            puuids: new Set([me.puuid]),
          });
        } else {
          existing.winsW += w * me.win;
          existing.gamesW += w;
          existing.gamesW2 += w * w;
          existing.puuids.add(me.puuid);
        }
      }
    }
  };

  for (const row of rows) {
    if (!patchIndex.has(row.patch)) continue;
    if (current === undefined || current.matchId !== row.matchId) {
      if (current !== undefined) processMatch(current);
      current = {
        matchId: row.matchId,
        patch: row.patch,
        rankKnownCount: row.rankKnownCount,
        rankScore: row.rankScore,
        participants: [],
      };
    }
    current.participants.push({
      championId: row.championId,
      role: row.role,
      win: row.win,
      puuid: row.puuid,
      teamId: row.teamId,
      championGames: row.championGames,
      masteryPoints: row.masteryPoints,
      perksJson: row.perksJson,
    });
  }
  if (current !== undefined) processMatch(current);

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

  return result;
}
