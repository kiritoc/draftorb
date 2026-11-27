# BL-013 evidence rule values (D-102)

Date: 2026-11-26. Scope: BL-013a mechanism (#76) + BL-013b values (#77).

## Chosen values

| Config (`rankWeightingConfigSchema`) |   Value | Meaning                                                                                                                                                                                    |
| ------------------------------------ | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `evidencePlayerWeightCap`            |    `30` | Max weighted games (`games_w`) one player may contribute to a single rune/item context row. The player's `wins_w`/`games_w2` are scaled by the same factor, preserving ratios and `n_eff`. |
| `evidenceMinDistinctPlayers`         |     `3` | Minimum distinct expert puuids (`players`) required before a rune page or item row is aggregated/exported.                                                                                 |
| `evidenceMasterPlusOnly`             | `false` | Optional "Master+ only" toggle; when true, rune evidence uses only the `MASTER_PLUS` bucket. Off by default per D-102.                                                                     |

## Mechanism shipped in BL-013a

- `rune_ctx` already stored `players`; `item_build` gained `players` (migration `021_item_build_players`, legacy rows default to `1` until re-aggregated).
- Both aggregators now keep a per-player weight map per context row, apply `evidencePlayerWeightCap`, and drop rows below `evidenceMinDistinctPlayers` instead of emitting a bare number.
- Exports carry `players` plus separate `winrate` and `pickShare` for rune pages and build items; `pickShare` still uses the raw pre-gate context total.
- Engine `recommendRunes` honors `evidenceMasterPlusOnly` (MASTER_PLUS bucket only). Draft pick ranking is unchanged (D-102 keeps broad data there).

## How the values were chosen

There is still no rune/item holdout calibration harness (T-027.b is TODO), so this is an evidence-coverage/concentration audit on the real patch `16.22` aggregate, not the draft-model D-023 log-loss gate. Method: copy `data/DraftOrb.sqlite` (5.3 GB), migrate to `021`, run `pnpm etl aggregate` + `pnpm etl export` with the mechanism enabled, then measure the pre-gate `players`/`games_w` distributions for `roles/<ROLE>/runes`, `builds` and `build-paths`.

### Minimum distinct players

Share of exported rows surviving `players >= min` (pre-gate audit):

|   min | rune pages | build items | build paths |
| ----: | ---------: | ----------: | ----------: |
|     1 |     100.0% |      100.0% |      100.0% |
|     2 |      72.7% |       97.1% |       97.8% |
| **3** |  **63.0%** |   **93.6%** |   **93.5%** |
|     4 |      57.4% |       88.2% |       87.0% |
|     5 |      53.8% |       81.8% |       65.2% |

`3` is the smallest value that removes one- and two-player evidence while keeping a majority of rune pages and >90% of item/path rows. `4`/`5` start deleting too much item and path evidence for a personal-scale dataset.

### Per-player weight cap

On the uncapped `16.22` rune-page audit, per-player average `games_w` (`gamesW / players`) was: p50 `4.64`, p75 `20.0`, p90 `36.5`, p95 `52.2`, p99 `89.0`, max `212.1`. A cap of `30` trims roughly the top ~10% of pages by per-player weight; re-aggregating `rune_ctx` with cap `30` put `2,451` of `1,122,043` context rows (0.2%) at the cap. Lower caps are too lossy for the same reason `n_eff` already handles sample size: cap `10` would have capped ~39% of exported rune pages (and pushed item per-player averages to the cap), cap `20` ~25%. Item rows have much higher distinct-player counts (median `13` vs rune pages median `6`), so the same cap is conservative there.

## Gate result

`DRAFTORB_DB_PATH=data/DraftOrb.sqlite DRAFTORB_PUBLIC_DIR=data/public pnpm etl aggregate` then `pnpm etl export` + `pnpm etl validate-export` on patch `16.22` with the final values: **PASSED** — SUPPORT 54, TOP 91, JUNGLE 70 recommendations; schema v4 exports include `players`, `winrate` and `pickShare`. The evidence rule reduced the patch `16.22` aggregates to `36,224` `rune_ctx` rows and `9,235` `item_build` rows (from `1,122,043` and `169,868` before the distinct-player minimum).

## Caveat

These values are priors set by the evidence audit above. They should be revisited by the rune/item backtest (T-027.b / D-023 item calibration) when that harness exists; the draft pick ranking intentionally does not use this rule.
