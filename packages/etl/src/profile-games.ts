/**
 * @draftorb/etl — Profile game extraction (T-091, D-068/D-069).
 *
 * Pure functions that turn a validated match-v5 payload into the
 * `profile_games` row for the configured profile's participant, plus the
 * match-timeline item build order. No I/O, no randomness — unit-testable.
 */

import type { Role } from '@draftorb/shared';

import { ROLE_BY_TEAM_POSITION, MATCH_PARTICIPANT_COUNT } from './participants';
import type { RiotMatchDto, RiotMatchTimeline, RiotParticipantDto } from './riot';

export interface ProfileGameRow {
  match_id: string;
  created_at: number;
  champion_id: number;
  role: Role;
  win: 0 | 1;
  ally_adc_id: number | null;
  enemy_support_id: number | null;
  enemy_adc_id: number | null;
  enemy_champions_json: string;
  keystone: number | null;
  primary_style: number | null;
  sub_style: number | null;
  perks_json: string | null;
  items_json: string;
  items_ordered_json: string | null;
  summoner1_id: number;
  summoner2_id: number;
}

export interface ProfileGameExtraction {
  row: ProfileGameRow;
  /** match-v5 participantId of the profile's participant (timeline events). */
  participantId: number;
}

function participantRole(participant: RiotParticipantDto): Role | null {
  return ROLE_BY_TEAM_POSITION[participant.teamPosition] ?? null;
}

function championOfRole(participants: readonly RiotParticipantDto[], role: Role): number | null {
  const found = participants.find((p) => participantRole(p) === role);
  return found?.championId ?? null;
}

interface RuneFields {
  keystone: number | null;
  primaryStyle: number | null;
  subStyle: number | null;
  perksJson: string | null;
}

function extractRunes(participant: RiotParticipantDto): RuneFields {
  const perks = participant.perks;
  if (!perks) {
    return { keystone: null, primaryStyle: null, subStyle: null, perksJson: null };
  }
  const primary =
    perks.styles.find((style) => style.description === 'primaryStyle') ?? perks.styles[0];
  const secondary =
    perks.styles.find((style) => style.description === 'subStyle') ?? perks.styles[1];
  const keystone = primary?.selections[0]?.perk ?? null;
  return {
    keystone,
    primaryStyle: primary?.style ?? null,
    subStyle: secondary?.style ?? null,
    perksJson: JSON.stringify(perks),
  };
}

/**
 * Extract the profile's game row from a match. Returns null when the
 * profile's participant is absent, has an unmapped role, or lacks summoner
 * spell ids (match-v5 always provides them; a missing value means the
 * payload is not usable for profile stats).
 */
export function extractProfileGame(
  match: RiotMatchDto,
  profilePuuid: string,
): ProfileGameExtraction | null {
  const participants = match.info.participants;
  if (participants.length !== MATCH_PARTICIPANT_COUNT) {
    return null;
  }
  const me = participants.find((p) => p.puuid === profilePuuid);
  if (!me) {
    return null;
  }
  const role = participantRole(me);
  const spell1Id = me.spell1Id ?? me.summoner1Id;
  const spell2Id = me.spell2Id ?? me.summoner2Id;
  if (role === null || spell1Id === undefined || spell2Id === undefined) {
    return null;
  }
  const participantId = me.participantId;
  if (participantId === undefined) {
    return null;
  }

  const allies = participants.filter((p) => p.teamId === me.teamId && p.puuid !== profilePuuid);
  const enemies = participants.filter((p) => p.teamId !== me.teamId);
  if (allies.length !== 4 || enemies.length !== 5) {
    return null;
  }

  const runes = extractRunes(me);
  const items = [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5].filter(
    (itemId) => itemId !== 0,
  );

  return {
    participantId,
    row: {
      match_id: match.metadata.matchId,
      created_at: match.info.gameCreation,
      champion_id: me.championId,
      role,
      win: me.win ? 1 : 0,
      ally_adc_id: championOfRole(allies, 'ADC'),
      enemy_support_id: championOfRole(enemies, 'SUPPORT'),
      enemy_adc_id: championOfRole(enemies, 'ADC'),
      enemy_champions_json: JSON.stringify(enemies.map((p) => p.championId)),
      keystone: runes.keystone,
      primary_style: runes.primaryStyle,
      sub_style: runes.subStyle,
      perks_json: runes.perksJson,
      items_json: JSON.stringify(items),
      items_ordered_json: null,
      summoner1_id: spell1Id,
      summoner2_id: spell2Id,
    },
  };
}

/**
 * Item build order for one participant from a match timeline: the
 * `ITEM_PURCHASED` item ids in timestamp order. Returns null when the
 * timeline carries no usable events for the participant.
 */
export function extractItemsOrdered(
  timeline: RiotMatchTimeline,
  participantId: number,
): number[] | null {
  const purchases: { timestamp: number; itemId: number }[] = [];
  for (const frame of timeline.info.frames) {
    for (const event of frame.events) {
      if (
        event.type === 'ITEM_PURCHASED' &&
        event.participantId === participantId &&
        event.itemId !== undefined &&
        event.itemId > 0
      ) {
        purchases.push({ timestamp: event.timestamp, itemId: event.itemId });
      }
    }
  }
  if (purchases.length === 0) {
    return null;
  }
  purchases.sort((a, b) => a.timestamp - b.timestamp);
  return purchases.map((purchase) => purchase.itemId);
}
