/**
 * @draftorb/etl — Item-event extraction from match timelines (T-051).
 *
 * Pure functions (no I/O): turn a validated match-v5 timeline plus the match
 * participant list into `item_events` rows. Covers the ticket rules:
 *
 *  - "completed item" = Data Dragon item with an empty `into` list that is not
 *    tagged `Consumable`/`Trinket` (wards and consumables) and not tagged
 *    `Lane`. Boots count even though Data Dragon lists their upgrades. The
 *    `Lane` tag marks the laning-phase family — Doran's-style starters, the
 *    support quest line (World Atlas -> Bounty of Worlds -> quest rewards)
 *    and lane components — none of which is a "completed item" for slot
 *    purposes; early ones get `item_slot` 0.
 *  - `item_slot`: 0 = starting purchase (before the first completed item and
 *    game time < `startWindowMs`), k >= 1 = k-th live completed-item purchase,
 *    NULL for components/consumables bought later.
 *  - `ITEM_UNDO` reverts the matching purchase (or re-activates a sale when it
 *    undoes a sale); `ITEM_SOLD` removes the item from later held states;
 *    `ITEM_DESTROYED` and every other event type are ignored.
 *  - `team_gold_diff`/`kills_diff` are the purchaser's team minus the enemy
 *    team at the event timestamp (gold from `participantFrames.currentGold`,
 *    kills from `CHAMPION_KILL` victim teams).
 *
 * Timeline `participantId`s share the match-v5 id space; events whose id does
 * not map to a match participant (e.g. the pseudo id 0 seen in real payloads)
 * are skipped.
 */

import type { ItemsMap } from '@draftorb/shared';

import type { RiotMatchTimeline, RiotMatchTimelineEvent } from './riot';

export type ItemClass = 'completed' | 'component' | 'consumable';

export interface ItemEventConfig {
  /** Purchases before the first completed item and below this age get slot 0. */
  readonly startWindowMs: number;
}

export const DEFAULT_ITEM_EVENT_CONFIG: ItemEventConfig = Object.freeze({
  startWindowMs: 90_000,
});

interface ItemShape {
  readonly into: readonly number[];
  readonly tags: readonly string[];
}

/**
 * Classifies a catalog item for slot purposes. Unknown ids (absent from the
 * catalog) are `component`: they never advance the completed-item index.
 */
export function classifyItem(item: ItemShape | undefined): ItemClass {
  if (item === undefined) return 'component';
  const tags = new Set(item.tags);
  if (tags.has('Consumable') || tags.has('Trinket')) return 'consumable';
  // The Data Dragon `Lane` tag marks the laning-phase family: Doran's-style
  // starters, the support quest line and lane components. None of them is a
  // "completed item"; early ones are starting purchases (item_slot 0).
  if (tags.has('Lane')) return 'component';
  // Boots count as completed items even though Data Dragon lists upgrades.
  if (item.into.length === 0 || tags.has('Boots')) return 'completed';
  return 'component';
}

export interface TimelineParticipantRef {
  readonly participantId: number;
  readonly puuid: string;
  readonly teamId: number;
}

export interface ItemEventRow {
  readonly puuid: string;
  readonly ts: number;
  readonly item_id: number;
  readonly type: 'purchase' | 'sold';
  readonly team_gold_diff: number;
  readonly kills_diff: number;
  readonly item_slot: number | null;
}

interface FlatEvent {
  readonly ts: number;
  readonly seq: number;
  readonly event: RiotMatchTimelineEvent;
}

interface FrameGold {
  readonly ts: number;
  readonly teamGold: ReadonlyMap<number, number>;
}

function compareEvents(a: FlatEvent, b: FlatEvent): number {
  return a.ts - b.ts || a.seq - b.seq;
}

/** Folds `participantFrames.currentGold` into per-team gold totals per frame. */
function frameGoldTimeline(
  timeline: RiotMatchTimeline,
  teamByParticipantId: ReadonlyMap<number, number>,
): FrameGold[] {
  const frames: FrameGold[] = [];
  for (const frame of timeline.info.frames) {
    if (frame.timestamp === undefined) continue;
    const participantFrames = frame.participantFrames;
    if (participantFrames === undefined) continue;
    const teamGold = new Map<number, number>();
    for (const [key, value] of Object.entries(participantFrames)) {
      const participantId = Number(key);
      const teamId = teamByParticipantId.get(participantId);
      const gold = value?.currentGold;
      if (teamId === undefined || gold === undefined) continue;
      teamGold.set(teamId, (teamGold.get(teamId) ?? 0) + gold);
    }
    if (teamGold.size > 0) {
      frames.push({ ts: frame.timestamp, teamGold });
    }
  }
  frames.sort((a, b) => a.ts - b.ts);
  return frames;
}

/** Team gold totals at `ts`: latest frame at or before it, else the earliest. */
function goldAt(frames: readonly FrameGold[], ts: number): ReadonlyMap<number, number> | undefined {
  let result: ReadonlyMap<number, number> | undefined;
  for (const frame of frames) {
    if (frame.ts > ts) break;
    result = frame.teamGold;
  }
  return result ?? frames[0]?.teamGold;
}

interface KillPoint {
  readonly ts: number;
  readonly teamId: number;
}

/** CHAMPION_KILL events mapped to the victim's team, sorted by timestamp. */
function killTimeline(
  timeline: RiotMatchTimeline,
  teamByParticipantId: ReadonlyMap<number, number>,
): KillPoint[] {
  const kills: KillPoint[] = [];
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (event.type !== 'CHAMPION_KILL') continue;
      const victimId = event.victimId;
      if (victimId === undefined) continue;
      const teamId = teamByParticipantId.get(victimId);
      if (teamId === undefined) continue;
      kills.push({ ts: event.timestamp, teamId });
    }
  }
  kills.sort((a, b) => a.ts - b.ts);
  return kills;
}

/**
 * Team kill difference (purchaser team - enemy team) at `ts`. Kill points
 * carry the VICTIM's team: a victim on my team is an enemy kill, a victim on
 * the enemy team is my kill.
 */
function killsDiffAt(kills: readonly KillPoint[], ts: number, teamId: number): number {
  let mine = 0;
  let theirs = 0;
  for (const kill of kills) {
    if (kill.ts > ts) break;
    if (kill.teamId === teamId) theirs += 1;
    else mine += 1;
  }
  return mine - theirs;
}

interface PurchaseRecord {
  readonly seq: number;
  readonly ts: number;
  readonly itemId: number;
  readonly itemClass: ItemClass;
  undone: boolean;
}

interface SaleRecord {
  readonly ts: number;
  readonly itemId: number;
  active: boolean;
}

/**
 * Replays one participant's item events into live purchase and sale records.
 * `ITEM_UNDO` reverts the matching purchase (`beforeId` > 0) or re-activates a
 * sale (`beforeId` = 0, `afterId` > 0); unmatched undos are ignored.
 */
function replayParticipantEvents(
  events: readonly FlatEvent[],
  classify: (itemId: number) => ItemClass,
): { purchases: PurchaseRecord[]; sales: SaleRecord[] } {
  const purchases: PurchaseRecord[] = [];
  const sales: SaleRecord[] = [];

  for (const { event } of events) {
    if (event.type === 'ITEM_PURCHASED') {
      const itemId = event.itemId;
      if (itemId === undefined || itemId <= 0) continue;
      purchases.push({
        seq: purchases.length,
        ts: event.timestamp,
        itemId,
        itemClass: classify(itemId),
        undone: false,
      });
      continue;
    }
    if (event.type === 'ITEM_SOLD') {
      const itemId = event.itemId;
      if (itemId === undefined || itemId <= 0) continue;
      sales.push({ ts: event.timestamp, itemId, active: true });
      continue;
    }
    if (event.type === 'ITEM_UNDO') {
      const beforeId = event.beforeId;
      const afterId = event.afterId;
      if (typeof beforeId === 'number' && beforeId > 0) {
        // Purchase undo: revert the most recent live purchase of that item.
        for (let i = purchases.length - 1; i >= 0; i -= 1) {
          const purchase = purchases[i];
          if (purchase !== undefined && !purchase.undone && purchase.itemId === beforeId) {
            purchase.undone = true;
            break;
          }
        }
      } else if (typeof afterId === 'number' && afterId > 0) {
        // Sale undo: the most recent active sale of that item never happened.
        for (let i = sales.length - 1; i >= 0; i -= 1) {
          const sale = sales[i];
          if (sale !== undefined && sale.active && sale.itemId === afterId) {
            sale.active = false;
            break;
          }
        }
      }
    }
    // ITEM_DESTROYED and every other type: ignored (ticket rule).
  }

  return { purchases, sales };
}

/**
 * Assigns `item_slot` to live purchases: 0 for starting purchases, k >= 1 for
 * the k-th live completed-item purchase, NULL otherwise. Sales do not free a
 * completed-item ordinal (the purchase still happened); only undos renumber.
 */
function assignSlots(
  purchases: readonly PurchaseRecord[],
  config: ItemEventConfig,
): Map<number, number | null> {
  const live = purchases.filter((p) => !p.undone);
  let firstCompletedTs: number | null = null;
  for (const purchase of live) {
    if (purchase.itemClass === 'completed') {
      firstCompletedTs = purchase.ts;
      break;
    }
  }

  const slots = new Map<number, number | null>();
  let completedSeq = 0;
  for (const purchase of live) {
    if (purchase.itemClass === 'completed') {
      completedSeq += 1;
      slots.set(purchase.seq, completedSeq);
    } else if (purchase.itemClass === 'consumable') {
      slots.set(purchase.seq, null);
    } else {
      const isStarting =
        purchase.ts < config.startWindowMs &&
        (firstCompletedTs === null || purchase.ts < firstCompletedTs);
      slots.set(purchase.seq, isStarting ? 0 : null);
    }
  }
  return slots;
}

/**
 * Extracts `item_events` rows for every match participant from a timeline.
 * Returns rows for live purchases (`type='purchase'`, with `item_slot`) and
 * active sales (`type='sold'`, `item_slot` NULL). Deterministic: same inputs
 * give the same rows in the same order (participants by id, events by ts).
 */
export function extractItemEvents(
  timeline: RiotMatchTimeline,
  participants: readonly TimelineParticipantRef[],
  items: ItemsMap,
  config: ItemEventConfig = DEFAULT_ITEM_EVENT_CONFIG,
): ItemEventRow[] {
  const teamByParticipantId = new Map<number, number>();
  const puuidByParticipantId = new Map<number, string>();
  for (const participant of participants) {
    teamByParticipantId.set(participant.participantId, participant.teamId);
    puuidByParticipantId.set(participant.participantId, participant.puuid);
  }

  const goldFrames = frameGoldTimeline(timeline, teamByParticipantId);
  const kills = killTimeline(timeline, teamByParticipantId);

  // Group flat item-relevant events per participant, preserving order.
  const byParticipant = new Map<number, FlatEvent[]>();
  let seq = 0;
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (
        event.type !== 'ITEM_PURCHASED' &&
        event.type !== 'ITEM_SOLD' &&
        event.type !== 'ITEM_UNDO'
      ) {
        continue;
      }
      const participantId = event.participantId;
      if (participantId === undefined || !puuidByParticipantId.has(participantId)) {
        continue;
      }
      const list = byParticipant.get(participantId);
      const flat = { ts: event.timestamp, seq, event };
      if (list === undefined) {
        byParticipant.set(participantId, [flat]);
      } else {
        list.push(flat);
      }
      seq += 1;
    }
  }

  const rows: ItemEventRow[] = [];
  const participantIds = [...byParticipant.keys()].sort((a, b) => a - b);
  for (const participantId of participantIds) {
    const events = byParticipant.get(participantId);
    const puuid = puuidByParticipantId.get(participantId);
    const teamId = teamByParticipantId.get(participantId);
    if (events === undefined || puuid === undefined || teamId === undefined) continue;

    const { purchases, sales } = replayParticipantEvents(
      [...events].sort(compareEvents),
      (itemId) => classifyItem(items[String(itemId)]),
    );
    const slots = assignSlots(purchases, config);

    const enemyTeamId = [...teamByParticipantId.values()].find((id) => id !== teamId);
    const stateAt = (ts: number): { team_gold_diff: number; kills_diff: number } => {
      const gold = goldAt(goldFrames, ts);
      const mine = gold?.get(teamId) ?? 0;
      const theirs = enemyTeamId === undefined ? 0 : (gold?.get(enemyTeamId) ?? 0);
      return { team_gold_diff: mine - theirs, kills_diff: killsDiffAt(kills, ts, teamId) };
    };

    for (const purchase of purchases) {
      if (purchase.undone) continue;
      const state = stateAt(purchase.ts);
      rows.push({
        puuid,
        ts: purchase.ts,
        item_id: purchase.itemId,
        type: 'purchase',
        team_gold_diff: state.team_gold_diff,
        kills_diff: state.kills_diff,
        item_slot: slots.get(purchase.seq) ?? null,
      });
    }
    for (const sale of sales) {
      if (!sale.active) continue;
      const state = stateAt(sale.ts);
      rows.push({
        puuid,
        ts: sale.ts,
        item_id: sale.itemId,
        type: 'sold',
        team_gold_diff: state.team_gold_diff,
        kills_diff: state.kills_diff,
        item_slot: null,
      });
    }
  }

  rows.sort((a, b) => a.ts - b.ts || a.puuid.localeCompare(b.puuid));
  return rows;
}
