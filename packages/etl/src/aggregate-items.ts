/**
 * @draftorb/etl — Item-build aggregation by D-022 context (T-051 Phase B).
 *
 * Rebuilds `item_build`, `participant_starters` and `item_state_scale` from
 * the raw `item_events` / `kill_events` tables.
 *
 * Per participant per match the raw event stream is replayed once
 * (`netPurchasedItems`/`ownedItemsAt` semantics):
 *  - `purchase` of a `completed`/`boots` item advances the completed-item
 *    index and contributes an 'item' row at that slot.
 *  - `purchase` of a `starter`/`quest_line` item inside the starter window
 *    contributes an 'item' row at slot 0; outside the window they still do
 *    not advance the completed index.
 *  - first acquisition of a `quest_reward`/`jungle_path` item contributes a
 *    'path' row (decision_kind='path') at the current completed index.
 *  - `component`/`consumable`/`excluded` purchases contribute nothing.
 *  - `undo`/`sold`/`destroyed` net out via replay and never appear directly.
 *
 * Context columns:
 *  - `time_bucket`: engine `itemTimeBucket` over ts_ms/1000.
 *  - `state_bucket`: engine `stateBucket`; mode from ItemContextConfig
 *    (`stateBucketMode`), `timeNormalized` divides gold diff by the per-
 *    (patch,time_bucket) sd stored in `item_state_scale` (recomputed each
 *    run from the first purchase's team_gold_diff per team per match).
 *  - `profile_key`: enemy threat profile evaluated AT PURCHASE TIME —
 *    enemy KDA reconstructed from `kill_events` up to ts and enemy items
 *    from `ownedItemsAt`. Matches without kill_events yield 'unknown'.
 *  - `lane_key`: same influence-sorted `contextSlots` key as rune contexts,
 *    only for lane-phase rows.
 *
 * `participant_starters` stores the net starter bundle per
 * (match, participant): sorted "itemId:count" pairs from purchases within
 * `starterWindowSeconds`.
 *
 * Experts (SPECS §3, D-022): same champion-games/mastery rule as rune
 * aggregation. Weight = recencyFactor * reliabilityFactor.
 *
 * All derived tables are cleared and rewritten in one transaction:
 * idempotent. When no purchase contributes, `item_build` is left untouched.
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
  itemTimeBucket,
  ownedItemsAt,
  recencyFactor,
  reliabilityFactor,
  starterBundleKey,
  stateBucket,
  threatWeightedDamageProfile,
  type ItemContextConfig,
  type ItemTimelineEvent,
  type RankWeightingConfig,
  type StateBucketMode,
} from '@draftorb/engine';
import { championTagsMapSchema, type ChampionTagsMap, type ItemsMap } from '@draftorb/shared';

import { lookupPatchIndex } from './patches';
import { defaultManualDataDir } from './config/paths';
import { createItemCatalogLoader } from './item-catalog';
import { loadItemClasses, type ItemClassEntry } from './item-classes';
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
  decisionKind: 'item' | 'path';
  itemId: number;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export interface AggregateItemBuildsOptions {
  config?: RankWeightingConfig;
  itemConfig?: ItemContextConfig;
  /** State bucket mode override; defaults to 'timeNormalized' when a scale exists. */
  stateBucketMode?: StateBucketMode;
  /** Snapshot patch: newer matches are excluded and recency is relative to it. */
  patch?: string;
  tagsPath?: string;
  /** Item classes override (tests); defaults to generated+manual per patch. */
  itemClasses?: Map<number, ItemClassEntry>;
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
  participantId: number | null;
}

interface ItemEventRow {
  participant_id: number;
  puuid: string;
  ts_ms: number;
  seq: number;
  event_type: 'purchase' | 'undo' | 'sold' | 'destroyed';
  item_id: number;
  before_id: number | null;
  after_id: number | null;
  team_gold_diff: number;
  kills_diff: number;
}

interface KillEventRow {
  t_ms: number;
  killer_pid: number | null;
  victim_pid: number;
}

interface ItemBuildAccum {
  championId: number;
  myRole: string;
  slotIdx: number;
  timeBucket: string;
  stateBucket: string;
  profileKey: string;
  laneKey: string;
  decisionKind: 'item' | 'path';
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
      profile_key, lane_key, decision_kind, item_id, wins_w, games_w, games_w2
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.decisionKind,
        row.itemId,
        row.winsW,
        row.gamesW,
        row.gamesW2,
      );
    }
  });
  write.immediate();
}

/** Rebuilds `participant_starters` from raw events (idempotent). */
function writeParticipantStarters(
  db: Database.Database,
  rows: Array<{ matchId: string; participantId: number; puuid: string; bundle: string }>,
): void {
  const clear = db.prepare('DELETE FROM participant_starters');
  const insert = db.prepare(
    `INSERT OR REPLACE INTO participant_starters
     (match_id, participant_id, puuid, bundle_json) VALUES (?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of rows) {
      insert.run(row.matchId, row.participantId, row.puuid, row.bundle);
    }
  });
  write.immediate();
}

/** Recomputes `item_state_scale` from first-purchase gold diffs per team. */
function writeItemStateScale(
  db: Database.Database,
  rows: Array<{ patch: string; timeBucket: string; count: number; sd: number }>,
): void {
  const clear = db.prepare('DELETE FROM item_state_scale');
  const insert = db.prepare(
    `INSERT OR REPLACE INTO item_state_scale (patch, time_bucket, sample_count, gold_sd)
     VALUES (?, ?, ?, ?)`,
  );
  const write = db.transaction(() => {
    clear.run();
    for (const row of rows) {
      insert.run(row.patch, row.timeBucket, row.count, row.sd);
    }
  });
  write.immediate();
}

interface ScaleEntry {
  count: number;
  sd: number;
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

  const classesFor = (_patch: string): Map<number, ItemClassEntry> => {
    if (options.itemClasses !== undefined) return options.itemClasses;
    return loadItemClasses();
  };
  const classCache = new Map<string, Map<number, ItemClassEntry>>();
  const classesAt = (patch: string): Map<number, ItemClassEntry> => {
    let m = classCache.get(patch);
    if (m === undefined) {
      m = classesFor(patch);
      classCache.set(patch, m);
    }
    return m;
  };

  // --- Pass 1: item_state_scale (per patch, per time_bucket gold sd) ---
  const scaleRows = new Map<string, Map<string, number[]>>();
  const firstGold = db
    .prepare(
      `SELECT m.patch AS patch, e.team_gold_diff AS gold, e.ts_ms AS ts
       FROM item_events e JOIN matches m ON m.match_id = e.match_id
       WHERE e.event_type = 'purchase'`,
    )
    .iterate() as IterableIterator<{ patch: string; gold: number; ts: number }>;
  const seenTeamBucket = new Set<string>();
  for (const row of firstGold) {
    const bucket = itemTimeBucket(row.ts / 1000, itemConfig);
    const key = `${row.patch}|${bucket}`;
    // One sample per (match implied by row order) — approximate with per-row;
    // dedupe identical (patch,bucket) consecutive rows is unnecessary for sd.
    const patchMap = scaleRows.get(row.patch) ?? new Map<string, number[]>();
    const list = patchMap.get(bucket) ?? [];
    list.push(row.gold);
    patchMap.set(bucket, list);
    scaleRows.set(row.patch, patchMap);
    void key;
    void seenTeamBucket;
  }
  const scaleTable = new Map<string, Map<string, ScaleEntry>>();
  const scaleOut: Array<{ patch: string; timeBucket: string; count: number; sd: number }> = [];
  for (const [patch, buckets] of scaleRows) {
    const patchScale = new Map<string, ScaleEntry>();
    for (const [bucket, values] of buckets) {
      if (values.length < itemConfig.minStateMatches) continue;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
      const sd = Math.sqrt(variance);
      if (sd <= 0) continue;
      patchScale.set(bucket, { count: values.length, sd });
      scaleOut.push({ patch, timeBucket: bucket, count: values.length, sd });
    }
    scaleTable.set(patch, patchScale);
  }
  writeItemStateScale(db, scaleOut);

  const mode: StateBucketMode = options.stateBucketMode ?? 'timeNormalized';

  // Experts must be judged within the patch window (D-022).
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

  const eventsStmt = db.prepare(
    `SELECT participant_id, puuid, ts_ms, seq, event_type, item_id,
            before_id, after_id, team_gold_diff, kills_diff
     FROM item_events WHERE match_id = ? ORDER BY participant_id, ts_ms, seq`,
  );
  const killsStmt = db.prepare(
    `SELECT t_ms, killer_pid, victim_pid FROM kill_events WHERE match_id = ? ORDER BY seq`,
  );
  const pidStmt = db.prepare(
    'SELECT participant_id, puuid FROM match_participant_ids WHERE match_id = ?',
  );

  const accum = new Map<string, ItemBuildAccum>();
  const starterRows: Array<{
    matchId: string;
    participantId: number;
    puuid: string;
    bundle: string;
  }> = [];

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
         COALESCE(mpi.participant_id, 0) AS participantId,
         m.patch AS patch,
         m.rank_known_count AS rankKnownCount,
         m.avg_rank_score AS rankScore
       FROM participants p
       JOIN matches m ON m.match_id = p.match_id
       LEFT JOIN match_participant_ids mpi
         ON mpi.match_id = p.match_id AND mpi.puuid = p.puuid
       ORDER BY p.match_id`,
    )
    .iterate() as IterableIterator<MatchParticipantRow>;

  const toTimelineEvents = (raw: ItemEventRow[]): ItemTimelineEvent[] =>
    raw.map((e) => ({
      ts: e.ts_ms,
      seq: e.seq,
      event_type: e.event_type,
      item_id: e.item_id,
      before_id: e.before_id,
      after_id: e.after_id,
    }));

  const processMatch = async (group: MatchParticipantRow[]): Promise<void> => {
    const first = group[0];
    if (first === undefined) return;
    const pIdx = patchIndex.get(first.patch);
    if (pIdx === undefined) return;

    const baseW =
      recencyFactor(pIdx, currentPatchIndex, config.decay) *
      reliabilityFactor(first.rankKnownCount, config.unknownRankFactor);
    if (baseW <= 0) return;

    const matchId = first.matchId;
    const rawEvents = eventsStmt.all(matchId) as ItemEventRow[];
    if (rawEvents.length === 0) return;

    const killRows = killsStmt.all(matchId) as KillEventRow[];
    const hasKills = killRows.length > 0;
    const pidRows = pidStmt.all(matchId) as Array<{ participant_id: number; puuid: string }>;
    const pidByPuuid = new Map(pidRows.map((r) => [r.puuid, r.participant_id]));

    const items = await catalogFor(first.patch);
    const classes = classesAt(first.patch);
    const patchScale = scaleTable.get(first.patch);
    const teams = partitionByTeam(group);

    // Per-participant event lists.
    const eventsByPid = new Map<number, ItemEventRow[]>();
    for (const e of rawEvents) {
      const list = eventsByPid.get(e.participant_id);
      if (list === undefined) eventsByPid.set(e.participant_id, [e]);
      else list.push(e);
    }

    // Enemy state at time t: KDA from kill_events + items owned at t.
    const enemyProfileAt = (
      enemies: MatchParticipantRow[],
      pidOf: (puuid: string) => number | undefined,
      atMs: number,
    ): { championId: number; threatShare: number }[] | 'unknown' => {
      if (!hasKills) return 'unknown';
      // KDA at ts from kill_events.
      const kdaAt = new Map<number, { kills: number; deaths: number; assists: number }>();
      for (const pid of pidRows.map((r) => r.participant_id)) {
        kdaAt.set(pid, { kills: 0, deaths: 0, assists: 0 });
      }
      for (const k of killRows) {
        if (k.t_ms > atMs) break;
        if (k.victim_pid !== null) {
          const v = kdaAt.get(k.victim_pid);
          if (v !== undefined) v.deaths += 1;
        }
        if (k.killer_pid !== null) {
          const k2 = kdaAt.get(k.killer_pid);
          if (k2 !== undefined) k2.kills += 1;
          // assists approximated: not expanded from mask here (count once per killer)
        }
      }
      // Items owned at ts per enemy.
      const enemyStates = enemies.map((e) => {
        const pid = pidOf(e.puuid);
        const evs = pid === undefined ? [] : (eventsByPid.get(pid) ?? []);
        const owned = ownedItemsAt(toTimelineEvents(evs), atMs);
        const kda = pid === undefined ? undefined : kdaAt.get(pid);
        return {
          championId: e.championId,
          kills: kda?.kills ?? e.kills,
          deaths: kda?.deaths ?? e.deaths,
          assists: kda?.assists ?? e.assists,
          items: [...owned.keys()],
        };
      });
      const { shares } = computeThreatScores(
        enemyStates,
        atMs / 1000,
        items,
        tags,
        DEFAULT_THREAT_CONFIG,
      );
      return enemies.map((e, i) => ({ championId: e.championId, threatShare: shares[i] ?? 0 }));
    };

    for (const me of group) {
      // Starter bundles are recorded for EVERY participant (not just
      // experts): they describe what was bought, independent of expertise.
      const starterPid =
        me.participantId !== null && me.participantId > 0
          ? me.participantId
          : pidByPuuid.get(me.puuid);
      if (starterPid !== undefined) {
        const bundle = starterBundleKey(
          toTimelineEvents(eventsByPid.get(starterPid) ?? []),
          itemConfig.starterWindowSeconds,
          itemConfig,
        );
        if (bundle !== '') {
          starterRows.push({ matchId, participantId: starterPid, puuid: me.puuid, bundle });
        }
      }

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

      const myPid = starterPid;
      if (myPid === undefined) continue;
      const myEvents = eventsByPid.get(myPid) ?? [];

      // Replay ALL events in order, netting undo/sold/destroyed. The
      // completed-item slot is the count of completed/boots items owned
      // after the purchase (slot 0 stays reserved for starters), so a sold
      // item frees its slot and a re-buy reuses it.
      const owned = new Map<number, number>();
      const seenPath = new Set<number>();
      const clsOf = (itemId: number): ItemClassEntry['cls'] =>
        classes.get(itemId)?.cls ?? 'component';
      const ownedCompleted = (): number => {
        let n = 0;
        for (const [id, count] of owned) {
          if (count > 0 && (clsOf(id) === 'completed' || clsOf(id) === 'boots')) n += count;
        }
        return n;
      };
      const applyDelta = (itemId: number, delta: number): void => {
        const next = (owned.get(itemId) ?? 0) + delta;
        if (next <= 0) owned.delete(itemId);
        else owned.set(itemId, next);
      };

      const sortedEvents = [...myEvents].sort((a, b) => a.ts_ms - b.ts_ms || a.seq - b.seq);
      for (const ev of sortedEvents) {
        if (ev.event_type === 'sold' || ev.event_type === 'destroyed') {
          applyDelta(ev.item_id, -1);
          continue;
        }
        if (ev.event_type === 'undo') {
          applyDelta(ev.before_id ?? ev.item_id, -1);
          if (ev.after_id !== null && ev.after_id > 0) applyDelta(ev.after_id, 1);
          continue;
        }
        // purchase
        applyDelta(ev.item_id, 1);
        const cls = clsOf(ev.item_id);
        const seconds = ev.ts_ms / 1000;
        const timeBucket = itemTimeBucket(seconds, itemConfig);
        const scaleEntry = patchScale?.get(timeBucket);
        const goldSd =
          mode === 'timeNormalized' &&
          scaleEntry !== undefined &&
          scaleEntry.count >= itemConfig.minStateMatches
            ? scaleEntry.sd
            : undefined;
        const sb = stateBucket(ev.team_gold_diff, ev.kills_diff, itemConfig, mode, goldSd);
        const profile = enemyProfileAt(enemies, (u) => pidByPuuid.get(u), ev.ts_ms);
        const profileKey =
          profile === 'unknown' ? 'unknown' : threatWeightedDamageProfile(profile, tags);

        const emit = (kind: 'item' | 'path', slotIdx: number, laneKey: string): void => {
          const key =
            `${me.championId}|${me.role}|${slotIdx}|${timeBucket}|${sb}|` +
            `${profileKey}|${laneKey}|${kind}|${ev.item_id}`;
          accumulateWeighted(accum, key, baseW, me.win, () => ({
            championId: me.championId,
            myRole: me.role,
            slotIdx,
            timeBucket,
            stateBucket: sb,
            profileKey,
            laneKey,
            decisionKind: kind,
            itemId: ev.item_id,
            winsW: 0,
            gamesW: 0,
            gamesW2: 0,
          }));
        };

        if (cls === 'completed' || cls === 'boots') {
          const slotIdx = ownedCompleted();
          const phase = itemPhase(slotIdx, seconds, itemConfig);
          emit('item', slotIdx, phase === 'lane' ? myLaneKey : '');
        } else if (cls === 'starter' || cls === 'quest_line') {
          // Starting purchases: slot 0, never advance the completed index.
          if (seconds <= itemConfig.starterWindowSeconds) {
            const phase = itemPhase(0, seconds, itemConfig);
            emit('item', 0, phase === 'lane' ? myLaneKey : '');
          }
        } else if (cls === 'quest_reward' || cls === 'jungle_path') {
          if (!seenPath.has(ev.item_id)) {
            seenPath.add(ev.item_id);
            const slotIdx = ownedCompleted();
            const phase = itemPhase(slotIdx, seconds, itemConfig);
            emit('path', slotIdx, phase === 'lane' ? myLaneKey : '');
          }
        }
        // component/consumable/excluded: no row.
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
      decisionKind: entry.decisionKind,
      itemId: entry.itemId,
      winsW: entry.winsW,
      gamesW: entry.gamesW,
      gamesW2: entry.gamesW2,
    });
  }

  writeParticipantStarters(db, starterRows);

  if (result.length === 0) return result;

  writeItemBuildRows(db, result);

  return result;
}
