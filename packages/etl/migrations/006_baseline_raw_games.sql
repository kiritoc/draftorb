-- Raw (unweighted) match count per baseline row, exported as the 6th
-- baseline column and reported as `rawGames` in `insufficientData`.
ALTER TABLE baseline ADD COLUMN games INTEGER NOT NULL DEFAULT 0;
