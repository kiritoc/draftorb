import type { RiotMatchDto, RiotParticipantDto } from './riot';

export interface ChallengeRow {
  match_id: string;
  puuid: string;
  participant_id: number | null;
  challenges_json: string | null;
}

function challengesJson(participant: RiotParticipantDto): string | null {
  const challenges: unknown = participant.challenges;
  if (typeof challenges !== 'object' || challenges === null || Array.isArray(challenges)) {
    return null;
  }
  return JSON.stringify(challenges);
}

/** Extracts raw challenges objects for every participant; pure, no I/O. */
export function extractChallenges(match: RiotMatchDto, matchId: string): ChallengeRow[] {
  return match.info.participants.map((participant) => ({
    match_id: matchId,
    puuid: participant.puuid,
    participant_id: participant.participantId ?? null,
    challenges_json: challengesJson(participant),
  }));
}
