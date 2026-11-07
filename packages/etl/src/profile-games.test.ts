import { describe, expect, it } from 'vitest';

import { extractItemsOrdered, extractProfileGame } from './profile-games';
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
    const { row, participantId } = result!;
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
