-- Match-detail challenges backfill (T-122 follow-up): raw per-participant
-- `challenges` objects from match-v5 detail, stored as JSON. Lane-advantage
-- fields (earlyLaningPhaseGoldExpAdvantage, laningPhaseGoldExpAdvantage,
-- maxCsAdvantageOnLaneOpponent, maxLevelLeadLaneOpponent,
-- visionScoreAdvantageLaneOpponent) are verified populated for ranked games
-- and are the Phase 3 lane-context inputs. challenges_json is NULL when the
-- payload omits the object; the row still exists so backfill completion is
-- countable without refetching.

CREATE TABLE participant_challenges (
  match_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  participant_id INTEGER CHECK (participant_id BETWEEN 1 AND 10),
  challenges_json TEXT,
  PRIMARY KEY (match_id, puuid)
);

CREATE INDEX idx_participant_challenges_match ON participant_challenges (match_id);
