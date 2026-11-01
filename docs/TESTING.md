# TESTING

## Layers

1. **Unit** (vitest): rank weighting, shrinkage, level mapping, role inference, threat score.
2. **Golden scenarios** (engine): fixed input data + draft -> expected ordering/reasons. Stored in `packages/engine/test/golden/*.json`.
3. **ETL**: fixtures of real Riot JSON (`packages/etl/test/fixtures`), mocked HTTP for the client.
4. **Web**: smoke tests (render, select champions, see recommendations).
5. **Vision (E7)**: evaluation harness on a screenshot dataset (accuracy per resolution/UI scale/language).

## Golden scenario ideas (engine)

- Blind pick, nothing known -> safe supports first.
- Only ally ADC known -> synergy dominates.
- Enemy support hard-counters candidate X -> X penalized with reason.
- Roles unknown for all champions -> inference gives sensible assignment, lower confidence reduces weights.
- Flex champion (e.g. plays mid/support) in enemy team -> confidence split.
- Low data pair -> `lowData` flag, delta 0.
- Empty pool -> only the overall list; non-empty pool -> `poolRecommendations` in overall order with `poolRank` (D-024).
- Pool champion without data -> `poolUnavailable` + `insufficientData`; unknown pool id -> `poolUnavailable`.
- Pool champion below the role threshold -> scored with the `offRole` warning.
- Web pagination: page boundaries, exhaustion hides the button, reset on draft change, two lists independent.
- Rank switch Emerald vs Diamond changes ordering only through data weights.
- Same input twice -> identical output (determinism).

## Property checks

- The pool never changes any score: same scores with and without a pool for shared champions; `poolRecommendations` is a subsequence of `recommendations`; the roleProb-set subsequence keeps its relative order when pool-only candidates are inserted.
- Score never NaN; recommendations sorted desc; reasons reference only known slots; no crash with empty input.

## Rules

- Every bug fix adds a regression test.
- Never loosen a golden test to make it pass without a DECISIONS.md entry.

## Expected tests: data retention, change scoring, breakpoints (SPEC 8)

- Weight product over time: successive change weights multiply across patches and floor at `MIN_WEIGHT`.
- Min across scopes: row weight = `age_weight × min(entity weights, global)` for each table shape.
- Scopes champion vs item vs global: a champion breakpoint touches `champion_stats`/`matchup_stats`/`build_stats` but not `item_stats`; an item breakpoint touches `item_stats`/`build_stats`; global touches all tables.
- Purge + grace + restore: soft-delete on new patch, hard delete after `GRACE_PATCHES`, restore works while soft-deleted. A downweight breakpoint never extends retention beyond N.
- `MIN_GAMES_STORED`: applied only at patch close (when a newer patch starts), only to `build_stats` and `matchup_stats`, never to `champion_stats`/`item_stats`, never while the patch still receives data.
- Change score fixtures: scalar 10→9 = 0.05; armor 30→36 + cooldown 10→9 = 0.15; cooldown array ≈ 0.065 (one contribution); ability replaced ≥ 0.6; identical = 0; description reworded = 0.3; ignored key / ARAM-only item = 0.
- Score → weight conversion: <0.1 ×1.0, 0.1–0.3 ×0.9, 0.3–0.6 ×0.5, ≥0.6 suggested breakpoint; a score exactly on a threshold goes to the UPPER band (compared after rounding to 4 decimals).
- Suggested / rejected / validated behavior: pending suggestion has no weight effect (badge "review needed"); rejected uses ×0.5 band; validated acts as active breakpoint.
- Bayesian smoothing with weighted `p0`: `smoothed_winrate = (weighted_wins + K × p0) / (effective_games + K)`, confidence on effective games.
- Hotfix merging: hotfixes merge into their major patch; one patch = one `patch_index`.
- `patch_index` ordering across a season change: ordering from the data source versions list, not parsed version numbers (14.24 → 15.1).
- First patch without previous version: `change_score = NULL` (same fallback, no warning).
- Newly released patch with very little data: displayed stats lean on older data; smoothing partly compensates; UI shows effective sample size.
- Idempotent re-run of detection: re-running overwrites the `entity_change_scores` row; identical entity → change_score 0.
- Overlapping `downweight` breakpoints multiply their `weight_factor`s (floored at `MIN_WEIGHT`); a `reset` still dominates (weight 0); same rule whether they share `from_patch_index` or not.

## 6. Retention, weights, change scoring, breakpoints (ETL)

- Patch ordering across a season-change fixture: Data Dragon `versions.json` reversed -> oldest-first ordinal; 14.24 -> 15.1 orders via `patch_index`, not numeric compare.
- Hotfix merge: all source versions sharing `major.minor` collapse to one `patch_index`.
- Unknown label: refresh `patches` first; if still absent, `invalid` reject.
- Prune idempotence: re-running `pnpm etl prune` deletes no additional matches; tombstone dedup (a relisted pruned match is not re-aggregated); `--dry-run` prints counts only.
- Weight product across patches; min across entities; floor at `minWeight`; `reset` = 0 (no floor).
- As-of evaluation: change events with `patch_index > asOf` have no effect; events at `<= asOf` apply.
- Byte-identical aggregates when `changeWeightEnabled` is off or no events/breakpoints exist (regression test).
- Band boundary values on half-open intervals: [0,0.1) x1.0, [0.1,0.3) x0.9, [0.3,0.6) x0.5, [0.6,1] suggested.
- Pending/rejected suggestion: effective weight x0.5 (never 1.0); monotonicity (score never decreases as change size grows for fixed keys).
- Breakpoint uniqueness and CHECK constraints; combination rule (reset dominates; downweight factors multiply).
- Key-order invariance of change score; weight in [0,1]; non-increasing with age for fixed change events; prune idempotent.
- Change-score fixtures on toy data (with shown arithmetic) AND real JSON fixtures: two consecutive real patches under `packages/etl/test/fixtures` (VERIFY Data Dragon structure).
