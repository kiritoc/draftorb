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

import type { ChampionTagsMap, Role } from '@draftorb/shared';
import {
  DEFAULT_CONFIG,
  DEFAULT_LANE_GROUPS,
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
}

// Back-off context levels (most specific = lowest number, SPECS §8.1).
const CONTEXT_LEVEL_LANE = 1;
const CONTEXT_LEVEL_DAMAGE_MIX = 2;
const CONTEXT_LEVEL_GLOBAL = 3;

const ROLE_ORDER: readonly string[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

interface RuneAccum {
  championId: number;
  myRole: string;
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
  perksJson: string;
}

/** Canonical damage mix of a team's champions. */
function damageMix(championIds: number[], tags: Map<number, string>): 'AD' | 'AP' | 'mixed' {
  let hasAd = false;
  let hasAp = false;
  for (const id of championIds) {
    const dmg = tags.get(id);
    if (dmg === 'AD') hasAd = true;
    else if (dmg === 'AP') hasAp = true;
    // Unknown / other damage types count as mixed signal.
    else {
      hasAd = true;
      hasAp = true;
    }
  }
  if (hasAd && hasAp) return 'mixed';
  if (hasAd) return 'AD';
  return 'AP';
}

function loadChampionTags(): Map<number, string> {
  const tagsPath = join(defaultManualDataDir(), 'champion-tags.json');
  let raw: ChampionTagsMap;
  try {
    raw = JSON.parse(readFileSync(tagsPath, 'utf8'));
  } catch {
    return new Map();
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
): number[] {
  const laneGroup = DEFAULT_LANE_GROUPS[me.role as Role];
  const candidates: Array<{
    championId: number;
    influence: number;
    side: number;
    roleOrder: number;
  }> = [];

  for (const role of laneGroup.allies) {
    const ally = allies.find((p) => p.role === role);
    if (!ally) continue;
    candidates.push({
      championId: ally.championId,
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

  return candidates
    .slice(0, config.contextSlots)
    .map((c) => c.championId)
    .sort((a, b) => a - b);
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

  const tags = loadChampionTags();

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
         p.perks_json AS perksJson,
         m.patch AS patch,
         m.rank_known_count AS rankKnownCount
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
    perksJson: string;
    patch: string;
    rankKnownCount: number;
  }>;

  // Group participants by match so lane context (needs all participants of a
  // match) can be resolved one match at a time.
  let current:
    | {
        matchId: string;
        patch: string;
        rankKnownCount: number;
        participants: MatchParticipant[];
      }
    | undefined;

  const processMatch = (match: {
    patch: string;
    rankKnownCount: number;
    participants: MatchParticipant[];
  }): void => {
    const pIdx = patchIndex.get(match.patch);
    if (pIdx === undefined) return;

    const w =
      recencyFactor(pIdx, currentPatchIndex, config.decay) *
      reliabilityFactor(match.rankKnownCount, config.unknownRankFactor);
    if (w <= 0) return;

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
      if (me.championGames < config.minChampGames) continue; // experts rule (SPECS §3)

      const myTeam = teams.get(me.teamId)!;
      const allies = myTeam.filter((p) => p.puuid !== me.puuid);
      const enemies = [...teams.values()].filter((t) => t !== myTeam).flat();

      const ctxIds = contextSlots(me, allies, enemies, config);
      const enemyChampIds = enemies.map((e) => e.championId);
      const mix = damageMix(enemyChampIds, tags);
      const phash = perksHash(me.perksJson);

      const contexts: Array<{ contextKey: string; contextLevel: number }> = [
        { contextKey: `lane:${ctxIds.join(',')}`, contextLevel: CONTEXT_LEVEL_LANE },
        { contextKey: `damagemix:${mix}`, contextLevel: CONTEXT_LEVEL_DAMAGE_MIX },
        { contextKey: 'global', contextLevel: CONTEXT_LEVEL_GLOBAL },
      ];

      for (const ctx of contexts) {
        const key = `${me.championId}|${me.role}|${ctx.contextKey}|${phash}`;
        const existing = accum.get(key);
        if (existing === undefined) {
          accum.set(key, {
            championId: me.championId,
            myRole: me.role,
            contextKey: ctx.contextKey,
            contextLevel: ctx.contextLevel,
            perksHash: phash,
            perksJson: me.perksJson,
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
      perksJson: row.perksJson,
    });
  }
  if (current !== undefined) processMatch(current);

  const result: RuneCtxRow[] = [];
  for (const entry of accum.values()) {
    result.push({
      championId: entry.championId,
      myRole: entry.myRole,
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
      champion_id, my_role, context_key, perks_hash, perks_json, wins_w, games_w, games_w2, players
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of result) {
      insert.run(
        row.championId,
        row.myRole,
        row.contextKey,
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
