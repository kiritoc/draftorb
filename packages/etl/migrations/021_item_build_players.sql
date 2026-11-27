-- D-102 evidence rule: item_build rows now carry the number of distinct
-- expert players behind the aggregated counts (same meaning as rune_ctx.players).
-- Legacy rows predating this column are treated as one-player evidence until
-- `pnpm etl aggregate` rewrites them; winrate/pick-share math is unchanged.

ALTER TABLE item_build ADD COLUMN players INTEGER NOT NULL DEFAULT 1;
