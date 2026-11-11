import { describe, expect, it } from 'vitest';

import type { Item, ItemsMap } from '@draftorb/shared';

import {
  classifyItem,
  extractItemEvents,
  type ItemEventRow,
  type TimelineParticipantRef,
} from './item-events';
import type {
  RiotMatchTimeline,
  RiotMatchTimelineEvent,
  RiotMatchTimelineParticipantFrame,
} from './riot';

// Catalog fixture: 9001 completed, 9002 boots, 9003 component, 2003 consumable,
// 1055 lane starter (Doran's-style), 7777 unknown-to-catalog handled separately.
const item = (id: number, into: number[], tags: string[]): Item => ({
  id,
  name: `item-${id}`,
  icon: `${id}.png`,
  goldTotal: 1000,
  purchasable: true,
  tags,
  from: [],
  into,
  stats: {},
});

const ITEMS: ItemsMap = {
  '9001': item(9001, [], []),
  '9002': item(9002, [9003], ['Boots']),
  '9003': item(9003, [9001], ['Damage']),
  '2003': item(2003, [], ['Consumable', 'Lane']),
  '1055': item(1055, [], ['Damage', 'Lane']),
  '3865': item(3865, [], ['Health', 'GoldPer', 'Lane']),
};

const PARTICIPANTS: TimelineParticipantRef[] = [
  { participantId: 1, puuid: 'puuid-a', teamId: 100 },
  { participantId: 2, puuid: 'puuid-b', teamId: 200 },
];

interface FrameSpec {
  ts?: number;
  gold?: Record<number, number>;
  events?: RiotMatchTimelineEvent[];
}

function timeline(frames: FrameSpec[]): RiotMatchTimeline {
  return {
    info: {
      gameId: 1,
      frames: frames.map((f) => ({
        ...(f.ts === undefined ? {} : { timestamp: f.ts }),
        events: f.events ?? [],
        ...(f.gold === undefined
          ? {}
          : {
              participantFrames: Object.fromEntries(
                Object.entries(f.gold).map(([pid, gold]) => [
                  pid,
                  {
                    participantId: Number(pid),
                    currentGold: gold,
                  } satisfies RiotMatchTimelineParticipantFrame,
                ]),
              ),
            }),
      })),
    },
  } as RiotMatchTimeline;
}

const ev = (
  timestamp: number,
  type: string,
  extra: Partial<RiotMatchTimelineEvent> = {},
): RiotMatchTimelineEvent => ({ timestamp, type, ...extra });

const purchase = (ts: number, itemId: number, participantId = 1) =>
  ev(ts, 'ITEM_PURCHASED', { participantId, itemId });

function rowsFor(
  tl: RiotMatchTimeline,
  participants: TimelineParticipantRef[] = PARTICIPANTS,
): ItemEventRow[] {
  return extractItemEvents(tl, participants, ITEMS);
}

const purchasesOf = (rows: ItemEventRow[], puuid = 'puuid-a') =>
  rows.filter((r) => r.puuid === puuid && r.type === 'purchase');

describe('classifyItem', () => {
  it('marks empty-into non-tagged items as completed', () => {
    expect(classifyItem(ITEMS['9001'])).toBe('completed');
  });

  it('marks boots as completed even with upgrades listed', () => {
    expect(classifyItem(ITEMS['9002'])).toBe('completed');
  });

  it('marks items with into upgrades as components', () => {
    expect(classifyItem(ITEMS['9003'])).toBe('component');
  });

  it('marks consumables and trinkets as consumable', () => {
    expect(classifyItem(ITEMS['2003'])).toBe('consumable');
  });

  it('marks Lane-tagged items (starters, quest line) as components', () => {
    expect(classifyItem(ITEMS['1055'])).toBe('component');
    expect(classifyItem(ITEMS['3865'])).toBe('component');
  });

  it('marks unknown ids as components', () => {
    expect(classifyItem(undefined)).toBe('component');
  });
});

describe('extractItemEvents', () => {
  it('assigns slot 0 to early non-completed purchases and k>=1 to completed items', () => {
    const rows = rowsFor(
      timeline([
        {
          events: [
            purchase(10_000, 3865), // World Atlas-style starter at 10 s
            purchase(12_000, 2003), // potion at 12 s -> consumable -> NULL
            purchase(20_000, 9003), // component before first completed, <90 s -> slot 0
            purchase(30_000, 9001), // first completed -> slot 1
            purchase(400_000, 9003), // component later -> NULL
            purchase(500_000, 9001), // second completed -> slot 2
          ],
        },
      ]),
    );
    const mine = purchasesOf(rows);
    expect(mine.map((r) => [r.item_id, r.item_slot])).toEqual([
      [3865, 0],
      [2003, null],
      [9003, 0],
      [9001, 1],
      [9003, null],
      [9001, 2],
    ]);
  });

  it('gives slot 0 only before the first completed item AND under 90 s', () => {
    const rows = rowsFor(
      timeline([
        {
          events: [
            purchase(200_000, 9003), // component at 200 s, before first completed -> NULL
            purchase(250_000, 9001), // first completed -> slot 1
            purchase(260_000, 9003), // component after first completed -> NULL
          ],
        },
      ]),
    );
    expect(purchasesOf(rows).map((r) => [r.item_id, r.item_slot])).toEqual([
      [9003, null],
      [9001, 1],
      [9003, null],
    ]);
  });

  it('reverts an undone purchase and renumbers completed slots', () => {
    const rows = rowsFor(
      timeline([
        {
          events: [
            purchase(30_000, 9001),
            ev(35_000, 'ITEM_UNDO', { participantId: 1, beforeId: 9001, afterId: 0 }),
            purchase(40_000, 9001),
            purchase(50_000, 9002), // boots -> completed
          ],
        },
      ]),
    );
    const mine = purchasesOf(rows);
    expect(mine.map((r) => [r.item_id, r.item_slot])).toEqual([
      [9001, 1],
      [9002, 2],
    ]);
  });

  it('undoes only the matching purchase, most recent first', () => {
    const rows = rowsFor(
      timeline([
        {
          events: [
            purchase(30_000, 9001),
            purchase(40_000, 9001), // second copy of same item
            ev(45_000, 'ITEM_UNDO', { participantId: 1, beforeId: 9001, afterId: 0 }),
          ],
        },
      ]),
    );
    const mine = purchasesOf(rows);
    // Only one of the two identical purchases survives (the later one).
    expect(mine).toHaveLength(1);
    expect(mine[0]?.item_slot).toBe(1);
  });

  it('records active sales and drops sales undone by ITEM_UNDO', () => {
    const rows = rowsFor(
      timeline([
        {
          events: [
            purchase(30_000, 9001),
            ev(100_000, 'ITEM_SOLD', { participantId: 1, itemId: 9001 }),
            purchase(200_000, 9002),
            ev(300_000, 'ITEM_SOLD', { participantId: 1, itemId: 9002 }),
            ev(310_000, 'ITEM_UNDO', { participantId: 1, beforeId: 0, afterId: 9002 }),
          ],
        },
      ]),
    );
    const sold = rows.filter((r) => r.type === 'sold');
    expect(sold.map((r) => r.item_id)).toEqual([9001]);
    expect(sold[0]?.item_slot).toBeNull();
  });

  it('ignores ITEM_DESTROYED and unmapped participant ids', () => {
    const rows = rowsFor(
      timeline([
        {
          events: [
            purchase(30_000, 9001),
            ev(40_000, 'ITEM_DESTROYED', { participantId: 1, itemId: 9001 }),
            purchase(50_000, 9001, 99), // unmapped participant
            purchase(60_000, 0, 1), // non-positive item id
            purchase(70_000, 9001),
          ],
        },
      ]),
    );
    const mine = purchasesOf(rows);
    expect(mine.map((r) => r.item_slot)).toEqual([1, 2]);
  });

  it('computes team gold and kill diffs at the event timestamp', () => {
    const rows = rowsFor(
      timeline([
        {
          ts: 0,
          gold: { 1: 1000, 2: 1000 },
          events: [
            ev(10_000, 'CHAMPION_KILL', { participantId: 1, victimId: 2 }),
            purchase(20_000, 9001),
          ],
        },
        {
          ts: 15_000,
          gold: { 1: 1600, 2: 1100 }, // team 100 +600, team 200 +100
        },
      ]),
    );
    const row = purchasesOf(rows)[0];
    expect(row?.team_gold_diff).toBe(500);
    expect(row?.kills_diff).toBe(1);
  });

  it('uses the earliest frame when the event precedes all gold frames', () => {
    const rows = rowsFor(
      timeline([{ ts: 50_000, gold: { 1: 2000, 2: 1000 } }, { events: [purchase(10_000, 9001)] }]),
    );
    expect(purchasesOf(rows)[0]?.team_gold_diff).toBe(1000);
  });

  it('orders rows deterministically by ts then puuid', () => {
    const rows = rowsFor(
      timeline([
        {
          events: [purchase(50_000, 9001, 2), purchase(10_000, 9001, 1), purchase(50_000, 9001, 1)],
        },
      ]),
    );
    expect(rows.map((r) => [r.ts, r.puuid])).toEqual([
      [10_000, 'puuid-a'],
      [50_000, 'puuid-a'],
      [50_000, 'puuid-b'],
    ]);
  });

  it('is deterministic for identical inputs', () => {
    const tl = timeline([
      {
        events: [purchase(30_000, 9001), purchase(10_000, 3865), purchase(60_000, 9002)],
      },
    ]);
    expect(rowsFor(tl)).toEqual(rowsFor(tl));
  });
});
