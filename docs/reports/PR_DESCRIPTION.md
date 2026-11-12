# feat: joint draft model, higher data volume, drafting UI and items engine (behind flags)

## 1. TL;DR

- Phase 0 audit complete: the D-082 prerequisite artifacts are all merged; the
  measured application rate limit is 0.833 req/s (~72k calls/day, shared with
  CI); lane/pair cells are far sparser than assumed (median n_eff 1.0–2.3).
- The current engine scores **worse than champion-baseline-only** on the frozen
  holdout (log-loss 0.6967 vs 0.6946) — strong evidence for the review findings.
- New recommendation behavior ships **OFF** behind config flags; the PR is
  mergeable with zero behavior change.
- Owner actions: accept/reject the PROPOSED ADRs, review `docs/proposed-etl-schedule.md`
  (schedule NOT applied — private repo + unverified Actions minutes), verify
  Riot product registration.

## 2. Changes by phase

| Phase              | Status           | Key files / commands                                                                                                                       | Commits   |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 0 Audit & baseline | done             | `docs/RIOT_API.md`, `docs/reports/model-review-baseline.md`                                                                                | pending   |
| 1 Engine fixes     | done (flags off) | `pairMainEffectAdjust` (D-088) + `--pair-adjust` backtest gate, `tune-priors` (D-090), `blendMode='logit'` (D-089); 532 engine tests green | `746c9a5` |
| 2 Data scaling     | partial          | `matches --call-budget/--time-budget`, `docs/proposed-etl-schedule.md` (schedule NOT applied)                                              | `b8c6e86` |
| 3 Joint model      | not started      | `packages/engine/src/joint/`, `etl fit-model`                                                                                              | –         |
| 4 Drafting UI      | not started      | experimental views                                                                                                                         | –         |
| 5 Items engine     | not started      | `items/analytic.ts`, `recommendItems`                                                                                                      | –         |
| 6 Items UI         | not started      | build view, GameState panel                                                                                                                | –         |
| 7 Consolidation    | not started      | docs + final comparison                                                                                                                    | –         |

## 3. Key numbers before/after

See `docs/reports/model-review-baseline.md` (Phase 0). Headline: 24,325 stored
matches, median pair-cell n_eff 2.3, lane cells ~1.0; engine log-loss 0.6967 vs
baseline-only 0.6946 on holdout patch 16.22.

## 4. Gates and how to enable

| Flag                   | Gate                                  | Verdict                                                                     | validationStatus | Enable change                                                   |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------- |
| `pairMainEffectAdjust` | backtest old vs new (`--pair-adjust`) | running                                                                     | unvalidated      | set `pairMainEffectAdjust: true` in engine config               |
| `blendMode='logit'`    | personalization ordering review       | implemented, unvalidated                                                    | n/a              | pass `blendMode:'logit'` in PersonalizeConfig                   |
| tuned priors           | `tune-priors` report review           | SUPPORT done: k0=40/k=160 → 0.6951 vs 0.6981 (in-sample; needs 2nd holdout) | unvalidated      | adopt winning k0/k/kLane into DEFAULT_CONFIG after owner review |
| joint model            | D-023-extended holdout gate           | not run                                                                     | unvalidated      | load joint export files + flag                                  |
| items layers           | ranking-accuracy bootstrap            | not run                                                                     | unvalidated      | per-layer flags                                                 |

## 5. ADRs proposed

- D-091 local-first ETL: schedule disabled, exports + periodic DB backups — **ACCEPTED by owner 2026-11-12**

- D-088 `pairMainEffectAdjust` — pair main-effect subtraction (PROPOSED, off by default)
- D-089 `blendMode='logit'` — log-odds personalization blend (PROPOSED, legacy default)
- D-090 `pnpm etl tune-priors` — prior grid search command (PROPOSED)
- D-082..D-087 (Phase B items) unchanged — no amendments needed so far

## 6. Findings F1–F9

Verdicts with evidence: `docs/reports/model-review-baseline.md` §(j). Summary:
F1 confirmed (cells far sparser than estimated), F2 confirmed analytically,
F3 unverified priors, F4 directionally confirmed (engine < baseline-only),
F5 confirmed by code inspection, F6 feasible (challenges verified),
F7 resolved by measurement (0.833 req/s app-bound), F8/F9 scope gaps confirmed.

## 7. Decisions taken on your behalf

- 5.2 guard evaluated: repo is PRIVATE (`kiritoc/draftorb`), Actions minutes
  UNVERIFIED, current runs ~1–3.5 h × 2/day. Higher ingest volume would increase
  monthly minutes → schedule change NOT applied; proposal doc to follow.
- 5.3 storage: gzipped DB ≈ 475 MiB vs 25% of verified 2 GiB asset limit
  (512 MiB) — ingest volume must be capped near current size.
- Backtest report copied from `data/public/backtest-draft.json` run output;
  masked-draft/paired-bootstrap metrics remain unimplemented (Phase 3 gate).

## 8. Owner actions

- [ ] Accept/reject upcoming PROPOSED ADRs (Phase 1+).
- [x] ~~Apply schedule~~ — SUPERSEDED by owner decision (D-091): schedule DISABLED,
      local-first pipeline; see `docs/proposed-etl-schedule.md` runbook.
- [x] Verify Riot portal registration — DONE (owner): registered as a personal product.
- [ ] Watch the first scheduled `etl.yml` run after merge.

## 9. Risks / approximations / unverified facts

- Actions-minutes quota for the private repo: UNVERIFIED (billing API needs a
  scope we lack); current usage ~5,400–11,400 min/month estimated from run
  durations.
- GitHub "no total release size" claim verified on docs.github.com; per-asset
  2 GiB verified.
- Completion curves count purchase events (not net replay) — approximation.
- `item_events` row volume (~442 rows/match) drives DB size; new extractors add
  modest per-match bytes.

## 10. Not done / follow-ups

Phases 2–7 pending (see TICKETS.md T-122..T-127). Masked-draft and paired
bootstrap metrics land with the Phase 3 gate.

## 11. How to run / test / roll back

`pnpm install && pnpm check`; `pnpm etl backtest draft`. Rollback: revert the
branch; all new behavior is flag-gated OFF.

## 12. Screenshots

None yet (Phase 4 pending).

## 13. Report index

- `docs/reports/model-review-baseline.md` — Phase 0 audit
- `docs/RIOT_API.md` — measured rate limits and policy notes
