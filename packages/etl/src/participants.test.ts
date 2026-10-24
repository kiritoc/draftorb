import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { riotMatchDtoSchema, riotPerksDtoSchema } from './riot';
import { extractParticipants, InvalidMatchParticipantsError } from './participants';

const fixture = riotMatchDtoSchema.parse(
  JSON.parse(
    readFileSync(new URL('../test/fixtures/match.json', import.meta.url), 'utf8'),
  ) as unknown,
);

describe('participant extraction', () => {
  it('extracts ten role-mapped participant rows from the match fixture', () => {
    const ranks = new Map([['puuid-ally-support', 6.75]]);
    const rows = extractParticipants(fixture, ranks);

    expect(rows).toHaveLength(10);
    expect(rows.filter((row) => row.win === 1)).toHaveLength(5);
    expect(rows.map(({ puuid, role }) => [puuid, role])).toEqual([
      ['puuid-ally-support', 'SUPPORT'],
      ['puuid-ally-top', 'TOP'],
      ['puuid-ally-jungle', 'JUNGLE'],
      ['puuid-ally-mid', 'MID'],
      ['puuid-ally-adc', 'ADC'],
      ['puuid-enemy-top', 'TOP'],
      ['puuid-enemy-jungle', 'JUNGLE'],
      ['puuid-enemy-mid', 'MID'],
      ['puuid-enemy-adc', 'ADC'],
      ['puuid-enemy-support', 'SUPPORT'],
    ]);

    const support = rows.find((row) => row.puuid === 'puuid-ally-support');
    expect(support).toMatchObject({
      rank_score: 6.75,
      champion_games: 0,
      mastery_points: null,
      is_expert: null,
      keystone: 8439,
      primary_style: 8400,
      sub_style: 8300,
      items_json: JSON.stringify([3869, 3109, 3110, 3117]),
    });
    expect(riotPerksDtoSchema.parse(JSON.parse(support?.perks_json ?? 'null')).statPerks).toEqual({
      defense: 5001,
      flex: 5008,
      offense: 5008,
    });
    expect(rows.find((row) => row.puuid === 'puuid-ally-top')?.rank_score).toBeNull();
  });

  it('rejects a match with an invalid role layout', () => {
    const invalid = {
      ...fixture,
      info: {
        ...fixture.info,
        participants: fixture.info.participants.map((participant, index) =>
          index === 1 ? { ...participant, teamPosition: 'MIDDLE' } : participant,
        ),
      },
    };

    expect(() => extractParticipants(invalid, new Map())).toThrow(InvalidMatchParticipantsError);
  });
});
