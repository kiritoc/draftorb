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
- Personalization (T-095..T-098, D-072..D-075): small profile sample shrinks toward the profile's global win rate (`K_SHRINK`); recency weighting halves an old game's weight after `HALF_LIFE_DAYS`; fallback level selection picks the first level with `n_eff >= MIN_GAMES`; trust blend lets a high-trust profile pick outrank the meta #1 in the profile-labeled list while "Best overall" stays identical with and without a profile (property test); favorites `include`/`only`/`hide` modes filter or flag without touching scores; insufficient-data entries carry `n_eff` and no percentage; `personalize` is deterministic.

## Property checks

- The pool never changes any score: same scores with and without a pool for shared champions; `poolRecommendations` is a subsequence of `recommendations`; the roleProb-set subsequence keeps its relative order when pool-only candidates are inserted.
- Score never NaN; recommendations sorted desc; reasons reference only known slots; no crash with empty input.

## Rules

- Every bug fix adds a regression test.
- Never loosen a golden test to make it pass without a DECISIONS.md entry.

## 6. Retention, weights, change scoring, breakpoints (ETL)

- Patch ordering across a season-change fixture: Data Dragon `versions.json` reversed -> oldest-first ordinal; 14.24 -> 15.1 orders via `patch_index`, not numeric compare.
- Hotfix merge: all source versions sharing `major.minor` collapse to one `patch_index`.
- Unknown label: refresh `patches` first; if still absent, `invalid` reject.
- Prune idempotence: re-running `pnpm etl prune` deletes no additional matches; tombstone dedup (a relisted pruned match is not re-aggregated); `--dry-run` prints counts only.
- Weight product across patches; min across entities incl. global; floor at `minWeight`; `reset` = 0 (no floor).
- As-of evaluation: change events with `patch_index > asOf` have no effect; events at `<= asOf` apply.
- Byte-identical aggregates when `changeWeightEnabled` is off or no events/breakpoints exist (regression test).
- Band boundary values on half-open intervals: [0,0.1) x1.0, [0.1,0.3) x0.9, [0.3,0.6) x0.5, [0.6,1] suggested.
- Pending/rejected suggestion: effective weight x0.5 (never 1.0); monotonicity (score never decreases as change size grows for fixed keys).
- Breakpoint uniqueness and CHECK constraints; combination rule (reset dominates; downweight factors multiply).
- Key-order invariance of change score; weight in [0,1]; non-increasing with age for fixed change events; prune idempotent.
- Change-score fixtures on toy data (with shown arithmetic) AND real JSON fixtures: trimmed CommunityDragon files of two consecutive real patches under `packages/etl/test/fixtures` (D-046, SPECS §15).
- `pruned` tombstone is permanent: `--reset` keeps `pruned` rows; a widened `--since-patch` does not resurrect them; `--reset-tombstones` does; `--since-patch` below the retention bound without `--reset-tombstones` is a usage error.
- Rune `reset` zeroes only `rune_ctx` rows whose page contains that rune while `baseline` is identical; global breakpoint lowers every aggregate table.
- `profile-sync` (T-091): re-run is idempotent and fetches only matches newer than the profile cursor; export validates against the shared schema; the anonymization whitelist is enforced — the exported JSON contains no other players' names, Riot IDs, puuids or match ids (fixture test with foreign identifiers present in `profile_games`); the 180-day/`profileMaxGames` cap is enforced; favorites arithmetic (top 15 recency-weighted in 90 days union top 5 mastery) is tested; mocked-HTTP tests cover account-v1/match-v5/champion-mastery-v4/timeline incl. 429/401/schema errors; a failed Riot call keeps the previous export and stored rows.
- Secret-leak check (T-092): a planted `RGAPI-` string (and the configured key value) in committed files or in `apps/web/dist` fails the check; the real tree and build output pass; the check never prints the secret itself.
- One failing insert per CHECK of both new tables (`data_breakpoints`, `entity_change_scores`) plus the duplicate-breakpoint test (NULL `scope_id` included).
