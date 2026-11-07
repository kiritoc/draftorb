import type { Role } from '@draftorb/shared';

import type { RiotMatchDto, RiotParticipantDto } from './riot';

export interface ParticipantRow {
  match_id: string;
  puuid: string;
  team_id: number;
  champion_id: number;
  role: Role;
  win: 0 | 1;
  rank_score: number | null;
  champion_games: number;
  mastery_points: number | null;
  is_expert: number | null;
  keystone: number;
  primary_style: number;
  sub_style: number;
  perks_json: string;
  items_json: string;
  kills: number;
  deaths: number;
  assists: number;
}

/** Ranked solo/duo: five roles per team, two teams. */
export const MATCH_TEAM_COUNT = 2;
export const MATCH_ROLES_PER_TEAM = 5;
export const MATCH_PARTICIPANT_COUNT = MATCH_TEAM_COUNT * MATCH_ROLES_PER_TEAM;

export class InvalidMatchParticipantsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMatchParticipantsError';
  }
}

export const ROLE_BY_TEAM_POSITION: Readonly<Record<string, Role>> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MID',
  BOTTOM: 'ADC',
  UTILITY: 'SUPPORT',
};

function getParticipantRunes(participant: RiotParticipantDto): {
  keystone: number;
  primaryStyle: number;
  subStyle: number;
  json: string;
} {
  const perks = participant.perks;
  const primary =
    perks?.styles.find((style) => style.description === 'primaryStyle') ?? perks?.styles[0];
  const secondary =
    perks?.styles.find((style) => style.description === 'subStyle') ?? perks?.styles[1];
  const keystone = primary?.selections[0]?.perk;

  if (!perks || !primary || !secondary || keystone === undefined) {
    throw new InvalidMatchParticipantsError(
      `Participant ${participant.puuid} is missing primary or secondary rune data.`,
    );
  }

  return {
    keystone,
    primaryStyle: primary.style,
    subStyle: secondary.style,
    json: JSON.stringify(perks),
  };
}

function mapParticipant(
  participant: RiotParticipantDto,
  matchId: string,
  ranksByPuuid: ReadonlyMap<string, number>,
): ParticipantRow {
  const role = ROLE_BY_TEAM_POSITION[participant.teamPosition];
  if (!role) {
    throw new InvalidMatchParticipantsError(
      `Participant ${participant.puuid} has unsupported teamPosition "${participant.teamPosition}".`,
    );
  }

  const runes = getParticipantRunes(participant);
  const items = [
    participant.item0,
    participant.item1,
    participant.item2,
    participant.item3,
    participant.item4,
    participant.item5,
  ].filter((itemId) => itemId !== 0);

  return {
    match_id: matchId,
    puuid: participant.puuid,
    team_id: participant.teamId,
    champion_id: participant.championId,
    role,
    win: participant.win ? 1 : 0,
    rank_score: ranksByPuuid.get(participant.puuid) ?? null,
    champion_games: 0,
    mastery_points: null,
    is_expert: null,
    keystone: runes.keystone,
    primary_style: runes.primaryStyle,
    sub_style: runes.subStyle,
    perks_json: runes.json,
    items_json: JSON.stringify(items),
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
  };
}

/** Extract role-valid participant rows without accessing storage or external services. */
export function extractParticipants(
  match: RiotMatchDto,
  ranksByPuuid: ReadonlyMap<string, number>,
): ParticipantRow[] {
  const participants = match.info.participants;
  if (participants.length !== MATCH_PARTICIPANT_COUNT) {
    throw new InvalidMatchParticipantsError(
      `Expected ${MATCH_PARTICIPANT_COUNT} participants, received ${participants.length}.`,
    );
  }

  const teams = new Map<number, Set<Role>>();
  const puuids = new Set<string>();
  for (const participant of participants) {
    if (puuids.has(participant.puuid)) {
      throw new InvalidMatchParticipantsError(`Duplicate participant PUUID ${participant.puuid}.`);
    }
    puuids.add(participant.puuid);

    const role = ROLE_BY_TEAM_POSITION[participant.teamPosition];
    if (!role) {
      throw new InvalidMatchParticipantsError(
        `Participant ${participant.puuid} has unsupported teamPosition "${participant.teamPosition}".`,
      );
    }
    const teamRoles = teams.get(participant.teamId) ?? new Set<Role>();
    if (teamRoles.has(role)) {
      throw new InvalidMatchParticipantsError(
        `Team ${participant.teamId} has more than one participant assigned to ${role}.`,
      );
    }
    teamRoles.add(role);
    teams.set(participant.teamId, teamRoles);
  }

  if (
    teams.size !== MATCH_TEAM_COUNT ||
    [...teams.values()].some((roles) => roles.size !== MATCH_ROLES_PER_TEAM)
  ) {
    throw new InvalidMatchParticipantsError(
      'Expected two teams with exactly one participant in each role.',
    );
  }

  return participants.map((participant) =>
    mapParticipant(participant, match.metadata.matchId, ranksByPuuid),
  );
}
