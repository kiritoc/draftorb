import { describe, expect, it } from 'vitest';

import {
  extractItemsOrdered,
  extractProfileGame,
  extractProfileStarterItems,
} from './profile-games';
import { makeMatch } from './matches.test-helpers';
import { riotMatchTimelineSchema } from './riot';

const PROFILE_PUUID = 'profile-puuid-0000';

/** The fixture's first participant is the UTILITY (SUPPORT) on team 100. */
function profileMatch(matchId: string, over: Record<string, unknown> = {}) {
  return makeMatch(matchId, {
    participants: [{ puuid: PROFILE_PUUID, spell1Id: 4, spell2Id: 7 }],
    ...over,
  });
}

describe('extractProfileGame', () => {
  it('extracts the whitelisted row for the profile participant', () => {
    const match = profileMatch('EUW1_1');
    const result = extractProfileGame(match, PROFILE_PUUID);
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a profile game');
    const { row, participantId } = result;
    expect(participantId).toBe(5);
    expect(row.match_id).toBe('EUW1_1');
    expect(row.created_at).toBe(1_760_000_000_000);
    expect(row.champion_id).toBe(412);
    expect(row.role).toBe('SUPPORT');
    expect(row.win).toBe(1);
    // Ally ADC = team-100 BOTTOM (champion 51); enemy SUPPORT = team-200
    // UTILITY (champion 89); enemy ADC = team-200 BOTTOM (champion 222).
    expect(row.ally_adc_id).toBe(51);
    expect(row.enemy_support_id).toBe(89);
    expect(row.enemy_adc_id).toBe(222);
    expect(JSON.parse(row.enemy_champions_json)).toEqual([10, 121, 7, 222, 89]);
    expect(row.summoner1_id).toBe(4);
    expect(row.summoner2_id).toBe(7);
    expect(row.items_ordered_json).toBeNull();
    expect(row.keystone).not.toBeNull();
    expect(row.perks_json).not.toBeNull();
  });

  it('returns null when the profile participant is absent', () => {
    const match = profileMatch('EUW1_2');
    expect(extractProfileGame(match, 'someone-else')).toBeNull();
  });

  it('returns null when summoner spells are missing', () => {
    const match = makeMatch('EUW1_3', {
      participants: [{ puuid: PROFILE_PUUID }],
    });
    expect(extractProfileGame(match, PROFILE_PUUID)).toBeNull();
  });

  it('returns null on a non-standard participant count', () => {
    const match = profileMatch('EUW1_4');
    const truncated = {
      ...match,
      info: { ...match.info, participants: match.info.participants.slice(0, 9) },
    };
    expect(extractProfileGame(truncated, PROFILE_PUUID)).toBeNull();
  });
});

describe('extractItemsOrdered', () => {
  it('collects ITEM_PURCHASED ids in timestamp order for the participant', () => {
    const timeline = riotMatchTimelineSchema.parse({
      info: {
        frames: [
          {
            events: [
              { timestamp: 30_000, type: 'ITEM_PURCHASED', participantId: 5, itemId: 3858 },
              { timestamp: 10_000, type: 'ITEM_PURCHASED', participantId: 5, itemId: 3340 },
              { timestamp: 20_000, type: 'ITEM_PURCHASED', participantId: 6, itemId: 9999 },
              { timestamp: 40_000, type: 'ITEM_SOLD', participantId: 5, itemId: 3858 },
              { timestamp: 50_000, type: 'ITEM_PURCHASED', participantId: 5, itemId: 0 },
            ],
          },
          {
            events: [{ timestamp: 60_000, type: 'ITEM_PURCHASED', participantId: 5, itemId: 2055 }],
          },
        ],
      },
    });
    expect(extractItemsOrdered(timeline, 5)).toEqual([3340, 3858, 2055]);
    expect(extractItemsOrdered(timeline, 6)).toEqual([9999]);
    expect(extractItemsOrdered(timeline, 7)).toBeNull();
  });
});

describe('extractProfileStarterItems', () => {
  function starterTimeline(events: Record<string, unknown>[]) {
    return riotMatchTimelineSchema.parse({ info: { frames: [{ events }] } });
  }

  it('returns the net starter-window bundle with the same rules as the aggregate path', () => {
    const match = profileMatch('EUW1_S1');
    const extraction = extractProfileGame(match, PROFILE_PUUID);
    if (extraction === null) throw new Error('expected a profile game');
    const pid = extraction.participantId;

    const timeline = starterTimeline([
      // Bought then undone inside the window: nets out.
      { timestamp: 8_000, type: 'ITEM_PURCHASED', participantId: pid, itemId: 1111 },
      { timestamp: 12_000, type: 'ITEM_UNDO', participantId: pid, itemId: 1111, beforeId: 1111 },
      { timestamp: 10_000, type: 'ITEM_PURCHASED', participantId: pid, itemId: 3340 },
      { timestamp: 20_000, type: 'ITEM_PURCHASED', participantId: pid, itemId: 3858 },
      // Bought then sold inside the window: nets out.
      { timestamp: 25_000, type: 'ITEM_PURCHASED', participantId: pid, itemId: 2000 },
      { timestamp: 30_000, type: 'ITEM_SOLD', participantId: pid, itemId: 2000 },
      // Outside the 45 s window: never part of the bundle.
      { timestamp: 50_000, type: 'ITEM_PURCHASED', participantId: pid, itemId: 9999 },
      // Another participant's purchases are ignored.
      { timestamp: 15_000, type: 'ITEM_PURCHASED', participantId: pid + 100, itemId: 7777 },
    ]);

    expect(extractProfileStarterItems(timeline, match.info.participants, pid)).toEqual([
      { itemId: 3340, count: 1 },
      { itemId: 3858, count: 1 },
    ]);
  });

  it('attributes pseudo-participant-0 support purchases like the aggregate path', () => {
    const match = profileMatch('EUW1_S2');
    const extraction = extractProfileGame(match, PROFILE_PUUID);
    if (extraction === null) throw new Error('expected a profile game');
    const pid = extraction.participantId;

    const timeline = starterTimeline([
      // World Atlas style purchase: participantId 0 at t=0, attributed to a
      // SUPPORT participant that does not already own the item.
      { timestamp: 0, type: 'ITEM_PURCHASED', participantId: 0, itemId: 3850 },
      { timestamp: 10_000, type: 'ITEM_PURCHASED', participantId: pid, itemId: 3340 },
    ]);

    const items = extractProfileStarterItems(timeline, match.info.participants, pid);
    // The profile participant is the only SUPPORT on team 100 without the
    // item; the pseudo purchase joins their bundle.
    expect(items).toContainEqual({ itemId: 3850, count: 1 });
    expect(items).toContainEqual({ itemId: 3340, count: 1 });
  });

  it('returns an empty array when the window recorded no purchases', () => {
    const match = profileMatch('EUW1_S3');
    const extraction = extractProfileGame(match, PROFILE_PUUID);
    if (extraction === null) throw new Error('expected a profile game');
    const timeline = starterTimeline([
      {
        timestamp: 60_000,
        type: 'ITEM_PURCHASED',
        participantId: extraction.participantId,
        itemId: 9999,
      },
    ]);
    expect(
      extractProfileStarterItems(timeline, match.info.participants, extraction.participantId),
    ).toEqual([]);
  });
});
