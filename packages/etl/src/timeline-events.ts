/**
 * @draftorb/etl — Raw timeline event extraction (T-051 Phase B).
 *
 * Pure functions (no I/O): turn a validated match-v5 timeline plus the match
 * participant list into RAW event rows for `item_events`, `kill_events` and
 * `match_participant_ids`. Raw facts only — classes, slots, buckets and keys
 * are derived later at aggregation so taxonomy changes never require
 * re-ingestion.
 *
 * Verified payload shapes (docs/reports/d082-audit.md, patch 16.22):
 *  - ITEM_PURCHASED / ITEM_SOLD / ITEM_DESTROYED: {timestamp, participantId,
 *    itemId}; ITEM_UNDO adds {beforeId, afterId, goldGain}.
 *  - CHAMPION_KILL: {timestamp, killerId, victimId, assistingParticipantIds,
 *    bounty, shutdownBounty, killStreakLength, ...}; killerId = 0 means the
 *    killer is not a champion (turret/minion) -> killer_pid NULL.
 *  - World Atlas (support quest starter) purchases arrive with the pseudo
 *    participantId 0, exactly one per support per match, at t = 0. They are
 *    attributed deterministically to SUPPORT participants that do not already
 *    own a purchase of the same item (see attributePseudoParticipantEvents).
 *  - Duplicate purchases at the same millisecond exist (e.g. two potions);
 *    `seq` preserves their order.
 */

import type { ItemsMap } from '@draftorb/shared';

import type { RiotMatchTimeline, RiotMatchTimelineEvent } from './riot';

export type RawItemEventType = 'purchase' | 'undo' | 'sold' | 'destroyed';

export interface ItemEventRawRow {
  readonly participant_id: number;
  readonly puuid: string;
  readonly ts_ms: number;
  readonly seq: number;
  readonly event_type: RawItemEventType;
  readonly item_id: number;
  readonly before_id: number | null;
  readonly after_id: number | null;
  readonly team_gold_diff: number;
  readonly kills_diff: number;
}

export interface KillEventRow {
  readonly seq: number;
  readonly t_ms: number;
  readonly killer_pid: number | null;
  readonly victim_pid: number;
  readonly assist_mask: number;
  readonly bounty: number | null;
  readonly shutdown_bounty: number | null;
}

export interface ParticipantIdRow {
  readonly participant_id: number;
  readonly puuid: string;
}

export interface TimelineParticipantRef {
  readonly participantId: number;
  readonly puuid: string;
  readonly teamId: number;
  /** Stored role; needed to attribute pseudo participantId 0 events. */
  readonly role: string;
}

export interface ExtractedTimelineEvents {
  readonly itemEvents: ItemEventRawRow[];
  readonly killEvents: KillEventRow[];
  readonly participantIds: ParticipantIdRow[];
}

const ITEM_EVENT_TYPES: ReadonlySet<string> = new Set([
  'ITEM_PURCHASED',
  'ITEM_SOLD',
  'ITEM_DESTROYED',
  'ITEM_UNDO',
]);

const EVENT_TYPE_MAP: Readonly<Record<string, RawItemEventType>> = {
  ITEM_PURCHASED: 'purchase',
  ITEM_SOLD: 'sold',
  ITEM_DESTROYED: 'destroyed',
  ITEM_UNDO: 'undo',
};

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
 * Team kill difference (teamId kills minus enemy kills) at `ts`. Kill points
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

function assistMaskOf(event: RiotMatchTimelineEvent): number {
  const assists = event.assistingParticipantIds;
  if (!Array.isArray(assists)) return 0;
  let mask = 0;
  for (const pid of assists) {
    if (typeof pid === 'number' && pid >= 1 && pid <= 31) {
      mask |= 1 << (pid - 1);
    }
  }
  return mask;
}

/**
 * Attributes pseudo-participant (id 0) ITEM_PURCHASED events. Real payloads
 * emit the support-quest starter purchase with participantId 0, once per
 * support. Each event is assigned to the next SUPPORT participant (by
 * participantId) that does not already own a purchase of the same item;
 * unmatched events are dropped rather than invented.
 */
function attributePseudoPurchases(
  pseudo: FlatEvent[],
  refs: readonly TimelineParticipantRef[],
  ownedByParticipant: Map<number, Set<number>>,
): Map<FlatEvent, number> {
  const assignment = new Map<FlatEvent, number>();
  const supports = refs
    .filter((r) => r.role === 'SUPPORT')
    .map((r) => r.participantId)
    .sort((a, b) => a - b);
  for (const event of pseudo) {
    const itemId = event.event.itemId;
    if (itemId === undefined) continue;
    const target = supports.find((pid) => !ownedByParticipant.get(pid)?.has(itemId));
    if (target === undefined) continue;
    assignment.set(event, target);
    const owned = ownedByParticipant.get(target) ?? new Set<number>();
    owned.add(itemId);
    ownedByParticipant.set(target, owned);
  }
  return assignment;
}

/**
 * Extracts all raw timeline rows for one match. `items` is accepted for
 * signature symmetry with callers but not used: classification is deferred
 * to aggregation.
 */
export function extractTimelineEvents(
  timeline: RiotMatchTimeline,
  participants: readonly TimelineParticipantRef[],
  _items?: ItemsMap,
): ExtractedTimelineEvents {
  const teamByParticipantId = new Map<number, number>();
  const puuidByParticipantId = new Map<number, string>();
  const knownIds = new Set<number>();
  for (const participant of participants) {
    teamByParticipantId.set(participant.participantId, participant.teamId);
    puuidByParticipantId.set(participant.participantId, participant.puuid);
    knownIds.add(participant.participantId);
  }

  const goldFrames = frameGoldTimeline(timeline, teamByParticipantId);
  const killPoints = killTimeline(timeline, teamByParticipantId);

  // Group flat item-relevant events per participant, preserving order.
  const byParticipant = new Map<number, FlatEvent[]>();
  const pseudoPurchases: FlatEvent[] = [];
  let seq = 0;
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (!ITEM_EVENT_TYPES.has(event.type)) continue;
      const participantId = event.participantId;
      const flat = { ts: event.timestamp, seq, event };
      if (participantId === 0 && event.type === 'ITEM_PURCHASED') {
        pseudoPurchases.push(flat);
      } else if (participantId !== undefined && knownIds.has(participantId)) {
        const list = byParticipant.get(participantId);
        if (list === undefined) {
          byParticipant.set(participantId, [flat]);
        } else {
          list.push(flat);
        }
      }
      seq += 1;
    }
  }

  // Owned-item sets for pseudo attribution: real purchases only.
  const ownedByParticipant = new Map<number, Set<number>>();
  for (const [pid, events] of byParticipant) {
    const owned = new Set<number>();
    for (const { event } of events) {
      if (event.type === 'ITEM_PURCHASED' && event.itemId !== undefined) {
        owned.add(event.itemId);
      }
    }
    ownedByParticipant.set(pid, owned);
  }
  const pseudoAssignment = attributePseudoPurchases(
    pseudoPurchases,
    participants,
    ownedByParticipant,
  );
  for (const [event, pid] of pseudoAssignment) {
    const list = byParticipant.get(pid);
    if (list === undefined) {
      byParticipant.set(pid, [event]);
    } else {
      list.push(event);
    }
  }

  const itemEvents: ItemEventRawRow[] = [];
  const participantIds = [...byParticipant.keys()].sort((a, b) => a - b);
  for (const participantId of participantIds) {
    const events = byParticipant.get(participantId);
    const puuid = puuidByParticipantId.get(participantId);
    const teamId = teamByParticipantId.get(participantId);
    if (events === undefined || puuid === undefined || teamId === undefined) continue;

    const enemyTeamId = [...teamByParticipantId.values()].find((id) => id !== teamId);
    const stateAt = (ts: number): { team_gold_diff: number; kills_diff: number } => {
      const gold = goldAt(goldFrames, ts);
      const mine = gold?.get(teamId) ?? 0;
      const theirs = enemyTeamId === undefined ? 0 : (gold?.get(enemyTeamId) ?? 0);
      return { team_gold_diff: mine - theirs, kills_diff: killsDiffAt(killPoints, ts, teamId) };
    };

    const sorted = [...events].sort(compareEvents);
    sorted.forEach((flat, index) => {
      const { event } = flat;
      const eventType = EVENT_TYPE_MAP[event.type];
      const itemId = event.itemId ?? event.beforeId ?? event.afterId;
      if (eventType === undefined || itemId === undefined || itemId <= 0) return;
      const state = stateAt(flat.ts);
      itemEvents.push({
        participant_id: participantId,
        puuid,
        ts_ms: flat.ts,
        seq: index,
        event_type: eventType,
        item_id: itemId,
        before_id: typeof event.beforeId === 'number' && event.beforeId > 0 ? event.beforeId : null,
        after_id: typeof event.afterId === 'number' && event.afterId > 0 ? event.afterId : null,
        team_gold_diff: state.team_gold_diff,
        kills_diff: state.kills_diff,
      });
    });
  }

  const killEvents: KillEventRow[] = [];
  let killSeq = 0;
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (event.type !== 'CHAMPION_KILL') continue;
      const victimId = event.victimId;
      if (victimId === undefined || !knownIds.has(victimId)) continue;
      const killerId = event.killerId;
      const killerPid =
        typeof killerId === 'number' && killerId >= 1 && killerId <= 10 && knownIds.has(killerId)
          ? killerId
          : null;
      killEvents.push({
        seq: killSeq,
        t_ms: event.timestamp,
        killer_pid: killerPid,
        victim_pid: victimId,
        assist_mask: assistMaskOf(event),
        bounty: typeof event.bounty === 'number' ? event.bounty : null,
        shutdown_bounty: typeof event.shutdownBounty === 'number' ? event.shutdownBounty : null,
      });
      killSeq += 1;
    }
  }
  killEvents.sort((a, b) => a.t_ms - b.t_ms || a.seq - b.seq);
  // Re-number after sorting so seq is the persisted order.
  const renumbered = killEvents.map((row, index) => ({ ...row, seq: index }));

  const participantIdRows: ParticipantIdRow[] = participants
    .filter((p) => knownIds.has(p.participantId))
    .map((p) => ({ participant_id: p.participantId, puuid: p.puuid }))
    .sort((a, b) => a.participant_id - b.participant_id);

  itemEvents.sort((a, b) => a.ts_ms - b.ts_ms || a.puuid.localeCompare(b.puuid) || a.seq - b.seq);

  return { itemEvents, killEvents: renumbered, participantIds: participantIdRows };
}
