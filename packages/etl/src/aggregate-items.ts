/**
 * @draftorb/etl — Item-build aggregation by D-022 context (T-051).
 *
 * Rebuilds `item_build` from `item_events` purchase rows. Each stored purchase
 * contributes its win-weighted evidence to the like-for-like context
 * (SPECS §8.2 step 7, D-022):
 *
 *   (champion, my_role, slot k, 5-min time bucket, state bucket at purchase,
 *    threat-weighted enemy profile AD|AP|mixed, lane_key in the lane phase)
 *
 * Context derivations (all offline, from stored data):
 *  - `time_bucket` / `state_bucket` / phase: engine `item-context` helpers
 *    over `item_events.ts` (ms -> s), `team_gold_diff`, `kills_diff` and the
 *    `ItemContextConfig` thresholds.
 *  - `profile_key`: enemy champion damage types weighted by threat shares
 *    (`computeThreatScores`). Per-purchase enemy KDA/items are not stored, so
 *    threat uses each enemy's FINAL KDA and items with `avgItemGold` evaluated
 *    at the purchase second — a documented approximation (D-082).
 *  - `lane_key`: `lane:` + the influence-sorted lane-context slots (same
 *    `contextSlots` selection as rune contexts), only for lane-phase
 *    purchases; empty string otherwise (DATA_MODEL: "empty outside lane").
 *
 * Experts (SPECS §3, D-022): `champion_games >= minChampGames` within the
 * patch window, or the role-limited mastery fallback — same rule as rune
 * aggregation. Weight = recencyFactor * reliabilityFactor (no rank buckets:
 * `item_build` is rank-agnostic, so the expertWeight kernel does not apply).
 *
 * The table is cleared and rewritten in one transaction: idempotent. When no
 * purchase contributes, `item_build` is left untouched.
 */

import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_CONFIG,
  DEFAULT_ITEM_CONTEXT_CONFIG,
  DEFAULT_THREAT_CONFIG,
  computeThreatScores,
  itemPhase,
  itemStateBucket,
  itemTimeBucket,
  recencyFactor,
  reliabilityFactor,
  threatWeightedDamageProfile,
  type ItemContextConfig,
  type RankWeightingConfig,
} from '@draftorb/engine';
import { championTagsMapSchema, type ChampionTagsMap, type ItemsMap } from '@draftorb/shared';

import { lookupPatchIndex } from './patches';
import { defaultManualDataDir } from './config/paths';
import { createItemCatalogLoader } from './item-catalog';
import {
  accumulateWeighted,
  assertPatchFormat,
  groupRowsByMatch,
  loadPatchWindow,
  partitionByTeam,
} from './aggregate-shared';
import {
  contextSlots,
  formatSlot,
  type LaneSlot,
  type MatchParticipant,
} from './aggregate-runes-context';

export interface ItemBuildRow {
  championId: number;
  myRole: string;
  slotIdx: number;
  timeBucket: string;
  stateBucket: string;
  profileKey: string;
  laneKey: string;
  itemId: number;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export interface AggregateItemBuildsOptions {
  config?: RankWeightingConfig;
  itemConfig?: ItemContextConfig;
  /** Snapshot patch: newer matches are excluded and recency is relative to it. */
  patch?: string;
  /** Champion tags file; defaults to data/manual/champion-tags.json. */
  tagsPath?: string;
  /** Data Dragon `fetch` override (tests). */
  fetchFn?: typeof fetch;
  onWarn?: (message: string) => void;
}

interface MatchParticipantRow extends MatchParticipant {
  matchId: string;
  patch: string;
  rankKnownCount: number;
  rankScore: number;
  itemsJson: string;
  kills: number;
  deaths: number;
  assists: number;
}

interface ItemEventPurchaseRow {
  puuid: string;
  ts: number;
  item_id: number;
  item_slot: number;
  team_gold_diff: number;
  kills_diff: number;
}

interface ItemBuildAccum {
  championId: number;
  myRole: string;
  slotIdx: number;
  timeBucket: string;
  stateBucket: string;
  profileKey: string;
  laneKey: string;
  itemId: number;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

function loadChampionTagsMap(tagsPath: string): ChampionTagsMap {
  let raw: ChampionTagsMap;
  try {
    raw = championTagsMapSchema.parse(JSON.parse(readFileSync(tagsPath, 'utf8')));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot load champion tags from ${tagsPath}: ${reason}`);
  }
  return raw;
}

function parseItemsJson(itemsJson: string): number[] {
  try {
    const parsed: unknown = JSON.parse(itemsJson);
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

function laneKeyOf(slots: readonly LaneSlot[]): string {
  if (slots.length === 0) return '';
  return `lane:${slots.map(formatSlot).join('|')}`;
}

/** Clears `item_build` and rewrites it in one transaction (idempotent). */
function writeItemBuildRows(db: Database.Database, rows: readonly ItemBuildRow[]): void {
  const clear = db.prepare('DELETE FROM item_build');
  const insert = db.prepare(
    `INSERT INTO item_build (
      champion_id, my_role, slot_idx, time_bucket, state_bucket,
      profile_key, lane_key, item_id, wins_w, games_w, games_w2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of rows) {
      insert.run(
        row.championId,
        row.myRole,
        row.slotIdx,
        row.timeBucket,
        row.stateBucket,
        row.profileKey,
        row.laneKey,
        row.itemId,
        row.winsW,
        row.gamesW,
        row.gamesW2,
      );
    }
  });
  write.immediate();
}

export async function aggregateItemBuilds(
  db: Database.Database,
  options: AggregateItemBuildsOptions = {},
): Promise<ItemBuildRow[]> {
  const config = options.config ?? DEFAULT_CONFIG;
  const itemConfig = options.itemConfig ?? DEFAULT_ITEM_CONTEXT_CONFIG;
  assertPatchFormat(options.patch);

  const snapshotPatch = options.patch;
  const { patchIndex, currentPatchIndex, snapshotIndex } = loadPatchWindow(db, snapshotPatch);

  const tags = loadChampionTagsMap(
    options.tagsPath ?? join(defaultManualDataDir(), 'champion-tags.json'),
  );
  const loadCatalog = createItemCatalogLoader(options.fetchFn ?? fetch, options.onWarn);
  const warnedPatches = new Set<string>();
  const catalogFor = async (patch: string): Promise<ItemsMap> => {
    const items = await loadCatalog(patch);
    if (items === null) {
      if (!warnedPatches.has(patch)) {
        warnedPatches.add(patch);
        options.onWarn?.(
          `item catalog unavailable for patch ${patch}; threat item-gold term is 0 for its matches`,
        );
      }
      return {};
    }
    return items;
  };

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
      const gameIndex = lookupPatchIndex(db, c.patch);
      if (gameIndex === undefined || snapshotIndex === undefined || gameIndex <= snapshotIndex) {
        continue;
      }
      const key = `${c.puuid}|${c.championId}`;
      futureGames.set(key, (futureGames.get(key) ?? 0) + c.games);
    }
  }

  const purchasesStmt = db.prepare(
    `SELECT puuid, ts, item_id, item_slot, team_gold_diff, kills_diff
     FROM item_events
     WHERE match_id = ? AND type = 'purchase' AND item_slot IS NOT NULL
     ORDER BY ts, puuid`,
  );

  const accum = new Map<string, ItemBuildAccum>();

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
         p.items_json AS itemsJson,
         p.kills AS kills,
         p.deaths AS deaths,
         p.assists AS assists,
         m.patch AS patch,
         m.rank_known_count AS rankKnownCount,
         m.avg_rank_score AS rankScore
       FROM participants p
       JOIN matches m ON m.match_id = p.match_id
       ORDER BY p.match_id`,
    )
    .iterate() as IterableIterator<MatchParticipantRow>;

  const processMatch = async (group: MatchParticipantRow[]): Promise<void> => {
    const first = group[0];
    if (first === undefined) return;
    const pIdx = patchIndex.get(first.patch);
    if (pIdx === undefined) return;

    const purchases = purchasesStmt.all(first.matchId) as ItemEventPurchaseRow[];
    if (purchases.length === 0) return;

    const baseW =
      recencyFactor(pIdx, currentPatchIndex, config.decay) *
      reliabilityFactor(first.rankKnownCount, config.unknownRankFactor);
    if (baseW <= 0) return;

    const items = await catalogFor(first.patch);
    const teams = partitionByTeam(group);

    for (const me of group) {
      const windowGames = me.championGames - (futureGames.get(`${me.puuid}|${me.championId}`) ?? 0);
      const masteryExpert =
        me.masteryPoints !== null && me.masteryPoints >= config.minMasteryPoints;
      if (windowGames < config.minChampGames && !masteryExpert) continue;

      const myTeam = teams.get(me.teamId);
      if (myTeam === undefined) continue;
      const allies = myTeam.filter((p) => p.puuid !== me.puuid);
      const enemies = [...teams.values()].filter((t) => t !== myTeam).flat();
      if (enemies.length === 0) continue;

      const slots = contextSlots(me, allies, enemies, config);
      const myLaneKey = laneKeyOf(slots);

      const enemyStates = enemies.map((e) => ({
        championId: e.championId,
        kills: e.kills,
        deaths: e.deaths,
        assists: e.assists,
        items: parseItemsJson(e.itemsJson),
      }));

      const myPurchases = purchases.filter((p) => p.puuid === me.puuid);
      // Threat shares depend on the enemy team and the purchase second only;
      // cache per timestamp so repeated slots share one computation.
      const sharesByTs = new Map<number, readonly number[]>();
      const sharesAt = (ts: number): readonly number[] => {
        const cached = sharesByTs.get(ts);
        if (cached !== undefined) return cached;
        const { shares } = computeThreatScores(
          enemyStates,
          ts / 1000,
          items,
          tags,
          DEFAULT_THREAT_CONFIG,
        );
        sharesByTs.set(ts, shares);
        return shares;
      };

      for (const purchase of myPurchases) {
        const seconds = purchase.ts / 1000;
        const phase = itemPhase(purchase.item_slot, seconds, itemConfig);
        const laneKey = phase === 'lane' ? myLaneKey : '';
        const timeBucket = itemTimeBucket(seconds, itemConfig);
        const stateBucket = itemStateBucket(
          purchase.team_gold_diff,
          purchase.kills_diff,
          itemConfig,
        );
        const shares = sharesAt(purchase.ts);
        const profileKey = threatWeightedDamageProfile(
          enemies.map((e, i) => ({
            championId: e.championId,
            threatShare: shares[i] ?? 0,
          })),
          tags,
        );

        const key =
          `${me.championId}|${me.role}|${purchase.item_slot}|${timeBucket}|` +
          `${stateBucket}|${profileKey}|${laneKey}|${purchase.item_id}`;
        accumulateWeighted(accum, key, baseW, me.win, () => ({
          championId: me.championId,
          myRole: me.role,
          slotIdx: purchase.item_slot,
          timeBucket,
          stateBucket,
          profileKey,
          laneKey,
          itemId: purchase.item_id,
          winsW: 0,
          gamesW: 0,
          gamesW2: 0,
        }));
      }
    }
  };

  for (const group of groupRowsByMatch(rows)) {
    if (group[0] !== undefined && !patchIndex.has(group[0].patch)) continue;
    await processMatch(group);
  }

  const result: ItemBuildRow[] = [];
  for (const entry of accum.values()) {
    result.push({
      championId: entry.championId,
      myRole: entry.myRole,
      slotIdx: entry.slotIdx,
      timeBucket: entry.timeBucket,
      stateBucket: entry.stateBucket,
      profileKey: entry.profileKey,
      laneKey: entry.laneKey,
      itemId: entry.itemId,
      winsW: entry.winsW,
      gamesW: entry.gamesW,
      gamesW2: entry.gamesW2,
    });
  }

  // No contributing purchases: leave existing rows unchanged.
  if (result.length === 0) return result;

  writeItemBuildRows(db, result);

  return result;
}
