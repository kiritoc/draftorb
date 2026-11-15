# BACKLOG — rework plan (D-098/D-099)

Status: draft for owner review. Source of truth for _what_ and _why_: `docs/GOALS.md`, `docs/DECISIONS.md` (D-096..D-109 accepted; D-114 is owner-approved and ticketed in B-001). This file replaces `docs/TICKETS.md` and `docs/PROMPTS.md` (both obsolete, scheduled for deletion later) and defines the pull-request-sized work packages for the rework.

## How to use this file

- One ticket = one PR. Tickets are ordered by milestone; dependencies are explicit.
- Every ticket and sub-ticket carries a `Status` field: `TODO`, `DOING`, `REVIEW`, `DONE` or `BLOCKED`. `docs/BACKLOG.md` is authoritative for ticket status; GitHub issues are tracking snapshots, and any GitHub project board is a view only, never the source of truth.
- Every ticket that changes behavior must, in the same PR: add/update tests, update `docs/SPECS.md` (or the relevant spec section), show sample sizes next to any new number, contain no secrets, and not implement any PROPOSED decision without owner approval.
- Size: S (< half day), M (about half a day), L (about a day — L tickets are split before work starts).
- "Unverified" marks anything not confirmed against the repo or an external source. Estimates are marked as estimates and need owner confirmation before they gate a decision.
- The change-score pipeline and breakpoints (D-046, D-047) are **not scheduled**: no ticket below uses them. `entity_change_scores` and `data_breakpoints` stay in the database unused.
- `docs/TICKETS.md` and `docs/PROMPTS.md` are obsolete; do not add tickets or prompts there. Only those two files are scheduled for deletion later; `docs/BACKLOG.md`, `docs/PROGRESS.md` and `docs/PROGRESS_ARCHIVE.md` remain.

## Milestones

| Milestone | Goal                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | Foundations: decisions D-110..D-114 written, real backtest report, Windows spike, public aggregates, joint-model deletion, personal-data hand-off, DB growth report, CI safety checks, Riot policy check |
| M1        | Version 1 — the pick screen. Step v1a: SUPPORT only (first usable build). Step v1b: TOP/JUNGLE enabled role-by-role after B-011 sample-size evidence; ADC/MID minimal                                    |
| M2        | Version 2 — runes, summoners and starters (top players / my data); personalization unblocked for all in-scope roles                                                                                      |
| M3        | Version 3 — in-game items with automatic game-client data, sell advice, fed option (blocked on the B-040 GO verdict and owner sign-off)                                                                  |

---

### B-000 — Backlog and review process

- **Milestone:** Process · **Size:** S · **Status:** DONE · **Decision IDs:** D-096..D-109
- **Goal:** Establish this file as the authoritative rework backlog and define the PR/review process around it.
- **Content:**
  - Define `docs/BACKLOG.md` as the source of truth for ticket status; GitHub issues and any project board are snapshots only.
  - Add the PR template and review checklist used by every rework PR.
  - Mark obsolete `docs/TICKETS.md` and `docs/PROMPTS.md` for later deletion; keep them as history until then.
- **Dependencies:** none.
- **Out of scope:** implementing any product ticket; deleting the obsolete docs in this PR.
- **Acceptance tests:**
  - Every B-xxx ticket and sub-ticket has a `Status` field.
  - `docs/WORKFLOW.md`, `AGENTS.md`, `README.md` and related live docs point to `docs/BACKLOG.md` instead of `docs/TICKETS.md`.
  - The PR title uses `B-000:` and the PR description states what was verified.

---

## M0 — Foundations

### B-001 — Write decisions D-110..D-114

- **Milestone:** M0 · **Size:** S · **Status:** TODO · **Decision IDs:** D-098, D-099, D-109, D-114 (owner decisions already taken; this ticket records them)
- **Goal:** Record the five owner decisions taken on 2026-11-15 as DECISIONS.md entries, and resolve the GOALS.md open items they close.
- **Content:**
  - D-110 — Language: TypeScript engine with a Tauri shell for the Windows 11 program; the M0 spike (B-002) validates it against owner-confirmed thresholds; full Rust remains possible later. This decision also records the AGENTS.md rule 4 amendment: the no-compiler native-dependency rule stays for `packages/shared`, `packages/engine`, `packages/etl` and tooling, while the desktop shell may require the Rust toolchain for Tauri. The PR that writes D-110 applies that AGENTS.md amendment; do not edit AGENTS.md for D-110 before the decision exists.
  - D-111 — Shared aggregates are published as a public release asset (no token needed); profile data and the SQLite database stay private.
  - D-112 — Delete the joint draft model code (engine `joint/`, ETL `joint-fit`/`fit-model`, `joint-model.json` export); D-092/D-092a stay in DECISIONS.md as the record of the negative result.
  - D-113 — Keep the ETL timeline extraction and the raw data (`item_events`, `kill_events`, lane snapshots, challenges, starters); the engine items layer is a rewrite in v3; do not delete the raw tables.
  - D-114 — Public versioned champion pool file — ACCEPTED (owner, 2026-11-15; owner approval: "Oui, on peut versionner le pool"). The champion pool is versioned in the public repo as `data/pool.config.json`: secret-free, zod-validated, carries a `schemaVersion`, and stores champion ids per role with an optional display name. The program remains the source of truth for the screen; an "Export to repo file" action writes `data/pool.config.json` and the user commits it; the program warns when its pool and the repo file differ; the scheduled pipeline reads only the repo copy; the pool never changes scores (D-101). Amends D-101 storage/sync mechanics and feeds D-102 pool-driven collection.
  - Update GOALS.md "Open items" (language, data location and pool versioning resolved; patch display still open until B-019 verifies the mapping).
- **Dependencies:** none (owner decisions are already taken).
- **Out of scope:** implementing anything; the D-110..D-114 text must not smuggle in unapproved PROPOSED decisions.
- **Acceptance tests:**
  - `docs/DECISIONS.md` contains D-110..D-114 in numeric order, each marked ACCEPTED with the owner date, and each names the decision(s) it amends or resolves; D-110 explicitly records the AGENTS.md rule 4 amendment (Rust toolchain allowed only for the Tauri desktop shell; no-compiler rule unchanged for shared/engine/etl/tooling), and that same PR applies the AGENTS.md edit.
  - D-114 records the owner approval quote and the exact `data/pool.config.json` contract above.
  - `docs/GOALS.md` open items reflect the resolved items; no contradiction between GOALS.md, DECISIONS.md and AUDIT.md §8 answers.
  - `pnpm check` passes (docs-only change).

### B-014 — First real draft backtest report (SUPPORT, TOP, JUNGLE)

- **Milestone:** M0 · **Size:** M · **Status:** TODO · **Decision IDs:** D-023, D-097, D-100
- **Goal:** Replace the empty `backtest-draft.json` placeholder with a real report and keep the "unvalidated" label honest.
- **Content:**
  - Run `pnpm etl backtest draft` for SUPPORT, TOP, JUNGLE on the current private database (holdout = latest patch, training = earlier patches per D-023). AUDIT §5k found a real Phase-0 run existed (log-loss 0.6967 vs baseline 0.6946 — engine worse than baseline) but was never committed; reproduce it on current data. The backtest rebuilds aggregates from the DB, so it does not wait for the TOP/JUNGLE export ticket (B-011).
  - Publish the report into the export (`backtest-draft.json` populated) so the app can show validation status.
  - Evaluate the result against the D-023 gate criteria: define the pass criteria first, compare the chosen holdout metric with the champion-baseline-only metric through a paired bootstrap confidence interval, and compute `validationStatus` from that gate. The "Unvalidated model" label (D-100) stays unless a report passes the gate.
  - **If the gate fails again, stop before choosing product behavior and record an explicit owner choice between the two options below — do not silently pick one:**
    1. **Champion-level statistics only** — the pick screen shows champion-level stats (win rate / pick share with sample sizes) and no ranked recommendation list.
    2. **Ranking with the unvalidated label** — the ranked recommendation list ships with the prominent "unvalidated" label until a later report passes the gate.
- **Dependencies:** B-001.
- **Out of scope:** tuning parameters to force a pass (D-090 `tune-priors` stays PROPOSED and unused unless the owner approves); changing the label logic without a passing report; implementing TOP/JUNGLE exports (B-011).
- **Acceptance tests:**
  - `data/public/backtest-draft.json` contains real metrics (log-loss, Brier, calibration, per-role breakdown) — not `holdoutGames: 0`.
  - The report defines the D-023 pass criteria before scoring them: the chosen holdout metric (log-loss) is compared with the champion-baseline-only metric through a paired bootstrap with a confidence interval, and `validationStatus` is computed as `validated` only when that comparison passes the agreed gate. Numeric thresholds (`bootstrapResamples`, `logLossTolerance`, confidence level) are marked as needing owner confirmation.
  - `validationStatus` is computed in the report rather than hard-coded; the consuming UI reads `backtest-draft.json` and shows "unvalidated" unless the report status is `validated`.
  - Report file committed or linked in the PR with the command used, the data patch range, and the pass-criteria/threshold note.
  - If the gate fails: the PR/decision log records the owner's choice (champion-level statistics only vs ranking with the unvalidated label), and B-010a's scope/SPECS reflect that choice.

### B-002 — Windows 11 Tauri spike: empty shell + engine benchmark

- **Milestone:** M0 · **Size:** M · **Status:** TODO · **Decision IDs:** D-098, D-099, D-110
- **Goal:** Prove the TypeScript + Tauri option on real Windows 11 hardware before committing the app to it.
- **Content:**
  - Minimal Tauri app (new `apps/desktop` or equivalent) that loads `packages/engine` + `packages/shared` and runs one real `recommend()` call on fixture data.
  - Measure and record in a report under `docs/reports/`: cold start to interactive, engine call latency, idle memory. Run on Windows 11 (owner's machine or CI runner with a measurement job).
  - Propose pass thresholds. Starting estimates from AUDIT.md §6 (**estimates, unverified, need owner confirmation**): cold start under ~3 s, idle memory under ~400 MB. If measurements miss, report options (smaller webview payload, lazy data load, Rust fallback).
- **Dependencies:** B-001.
- **Out of scope:** real UI, data download, SQLite access, bundling the full export set.
- **Acceptance tests:**
  - The spike app builds and launches on Windows 11; a screen shows the engine's `recommend()` output for a fixed fixture draft.
  - `docs/reports/` contains a spike report with measured cold-start, engine latency and idle-memory numbers, the proposed thresholds, and an explicit "owner confirmed / rejected" line left blank for the owner.
  - A GO/NO-GO recommendation for D-110 is stated; if NO-GO, the report lists the Rust-fallback plan.

### B-003 — Windows CI job + native-dependency check

- **Milestone:** M0 · **Size:** S · **Status:** TODO · **Decision IDs:** D-098, D-099, D-110
- **Goal:** Make Windows a first-class CI target for the desktop work and verify the riskiest native dependency.
- **Content:**
  - CI job on `windows-latest` (Node 22): install, `pnpm check`, and — once B-002 lands — build the Tauri spike. The Tauri/desktop build may require the Rust toolchain (D-110); that exception applies only to `apps/desktop` build tooling.
  - Verify `better-sqlite3` loads from its prebuilt binary on Windows Node 22 (AUDIT.md §5j verified the prebuilds exist in the package; this ticket proves they load in CI). The no-compiler native-dependency rule remains in force for `packages/shared`, `packages/engine`, `packages/etl` and tooling.
  - Document any Windows-only failures in `docs/BUGS.md`.
- **Dependencies:** B-001. (Can run in parallel with B-002; the Tauri build step waits for B-002.)
- **Out of scope:** macOS/Linux-specific fixes; ETL-on-Windows end-to-end (unverified per AUDIT §5j — log as a bug, don't fix here).
- **Acceptance tests:**
  - A `windows-latest` CI job exists, is green, and runs `pnpm check`.
  - CI output or a test asserts `better-sqlite3` opens a database on Windows without a compiler toolchain.
  - Results (pass/fail per step) are recorded in the PR description.

### B-004 — Public release of shared aggregates + data-size budget

- **Milestone:** M0 · **Size:** M · **Status:** TODO · **Decision IDs:** D-099, D-111, D-096
- **Goal:** Make the aggregate data downloadable at launch with no token, and bound its size.
- **Content:**
  - Publish the shared aggregates (`data/public/<patch>/` tree and `latest.json`; **exclude `profiles/`** — profile data stays private, D-111) as a public GitHub release asset. Audit §5e verified the export tree contains no PUUIDs, match ids or foreign names; `profiles/*.json` contains the owner's Riot ID and must not be published.
  - Measure and record the budget: gzipped database size (~933 MiB measured 2026-11-15, AUDIT §5h — estimate context only, DB stays private) and per-patch export size (~9.2 MB uncompressed today, AUDIT §2.2; gzipped size to be measured in this ticket). The app download budget target: state the measured export size and a proposed cap (estimate: keep each patch dir under the SPECS §10 5 MB-per-file rule already enforced by `pnpm etl export`).
  - Add/adjust the ETL publish path so a public release asset can be produced without the private state repo (D-111); keep `pnpm etl pull` working for the private DB backup path.
- **Dependencies:** B-001.
- **Out of scope:** the app-side downloader (lands with the app scaffold in M1); moving `profiles/` anywhere.
- **Acceptance tests:**
  - A public release (or dry-run artifact + documented command) contains the patch export tree and `latest.json`, and contains **no** `profiles/` directory.
  - A size report lists: export tree bytes, gzipped bytes, per-file sizes, gzipped DB bytes (for the record); each number cites how it was measured.
  - `pnpm etl export` still passes its existing size checks; `pnpm etl pull` is unchanged or its change is documented.
  - Automated check (test or script) fails if a PUUID-like or `profiles/` path appears in the publishable set.

### B-005 — Delete the joint model + fix stale docs (AUDIT §7)

- **Milestone:** M0 · **Size:** M · **Status:** TODO · **Decision IDs:** D-112, D-109
- **Goal:** Remove dead code whose validation gates failed, and repair the documentation contradictions found by the audit.
- **Content:**
  - Delete `packages/engine/src/joint/`, `packages/etl/src/joint-fit.ts`, `commands/fit-model.ts`, the `joint-model.json` export step, and their tests. Keep D-092/D-092a in DECISIONS.md untouched (negative-result record).
  - Remove `fit-model` from CLI help/docs; remove `joint` references from SPECS/DATA_MODEL if any.
  - Fix the stale statements in AUDIT.md §7: ARCHITECTURE.md scaffold/latest.json claims, DATA_MODEL.md SUPPORT-only line, GLOSSARY.md `exportMinGames` "unverified" note (default is 10), PROGRESS.md cron line.
- **Dependencies:** B-001 (D-112 must exist first).
- **Out of scope:** deleting `item_events`/`kill_events` or any timeline code (D-113); deleting `entity_change_scores`/`data_breakpoints` (not scheduled, but also not deleted by this ticket — leave for a later explicit decision).
- **Acceptance tests:**
  - `rg "joint|fit-model" packages apps` returns no code references. Documentation exceptions allowed to keep historical mentions: `docs/DECISIONS.md` D-092/D-092a/D-112, `docs/AUDIT.md`, `docs/BACKLOG.md` and `docs/PROGRESS.md` (including `docs/PROGRESS_ARCHIVE.md` once the current log is archived).
  - `pnpm check` green; `pnpm etl help` no longer lists `fit-model`.
  - Each AUDIT.md §7 row is either fixed or explicitly deferred with a note; `docs/PROGRESS.md` gets a handoff entry.

### B-006 — Personal data hand-off design

- **Milestone:** M0 · **Size:** S · **Status:** TODO · **Decision IDs:** D-096, D-099, D-101, D-102, D-111, D-114
- **Goal:** Define the private/profile and public/pool data paths before any UI depends on them.
- **Content (design only):**
  - **Profile export → program:** the app reads a local profile export file produced by `pnpm etl profile-sync` (refresh) or delivered by `pnpm etl pull`/export, from a folder the user chooses in settings. The program stores no Riot token and never calls Riot; if the file is absent or invalid, personal-record UI shows "no data" and the rest of the app works.
  - **Pool → scheduled pipeline (D-114):** the program is the source of truth for the screen; an "Export to repo file" action writes `data/pool.config.json` (secret-free, zod-validated, `schemaVersion`, champion ids per role with optional name) and the user commits it. The scheduled pipeline reads only the repo copy, and the program warns when its pool and the repo file differ. Because the repo is public, the pool list itself is public — it must never contain PUUIDs, Riot IDs, match ids or foreign player names.
  - Document the exact file names, schema/version, missing-data behavior, and which parts are local-only vs committed.
- **Dependencies:** B-001.
- **Out of scope:** implementing the loaders/UI (B-016a/B-018/B-023 consume this contract); moving `profiles/` into git or any public artifact.
- **Acceptance tests:**
  - `docs/SETUP.md` and/or `docs/SPECS.md` specify the profile-export folder contract, the `data/pool.config.json` schema, and the "no data" fallback.
  - The hand-off spec covers the D-114 mechanics: "Export to repo file" action, user commit step, program warning when the in-app pool and repo file differ, zod schema validation with `schemaVersion`, and the note that the repo is public so the pool list is public.
  - A privacy checklist states: profile export stays local/private; `pool.config.json` is public-safe preference data only; no token is stored in the program.
  - Owner sign-off recorded on the hand-off design before B-018/B-023 implementation starts.

### B-007 — Database size and growth report

- **Milestone:** M0 · **Size:** M · **Status:** TODO · **Decision IDs:** D-003, D-091, D-094, D-113
- **Goal:** Measure how large the private SQLite DB is, how fast it grows, and what dominates it before retention decisions are needed.
- **Content:**
  - Measure current DB file size, gzip size, row counts, and per-table bytes (`dbstat`) — AUDIT §5h measured ~5.28 GiB with `item_events` ~72% of pages; re-measure on current data.
  - Estimate growth per day using available timestamps/extractor runs/state-release history; state the method and confidence (mark unverified if history is insufficient).
  - Compare projected growth against the 2 GiB release-asset limit (D-091) and private state-repo constraints; note that public aggregates are unaffected.
  - Propose an alert threshold and a retention/prune plan for raw timeline tables (`item_events`, `kill_events`, `lane_snapshots`, `participant_challenges`, starters) — what to keep, what can be pruned or regenerated, and impact on backtests/items.
- **Dependencies:** none (read-only measurement on the existing DB).
- **Out of scope:** deleting or pruning any data; changing the pipeline; implementing the alert.
- **Acceptance tests:**
  - A report under `docs/reports/` lists measurements, per-table dominance, growth/day estimate with method, and the 2 GiB comparison.
  - A PROPOSED decision in `docs/DECISIONS.md` records the recommended alert threshold and retention/prune plan; owner approval is required before any deletion.
  - No database or pipeline changes in the PR.

### B-008 — CI safety automation

- **Milestone:** M0 · **Size:** M · **Status:** TODO · **Decision IDs:** D-094, D-096, D-111
- **Goal:** Make the public-repo safety rules enforceable in CI instead of review-only.
- **Content:**
  - Add CI checks that fail on: secret/API-key patterns and PUUID-like identifiers in the diff; `profiles/` paths or the SQLite DB appearing in public artifacts/releases; PR titles without a `B-xxx` ticket id.
  - Tune patterns to avoid false positives (e.g. sha256 file hashes in manifests are not PUUIDs).
  - Document the checks and how to fix a failure in `docs/WORKFLOW.md` or `docs/SETUP.md`.
- **Dependencies:** B-003 (CI job exists); can run in parallel with other M0 work.
- **Out of scope:** changing what data is collected; blocking legitimate aggregate exports.
- **Acceptance tests:**
  - Fixture violations (fake secret, PUUID, `profiles/` path, missing B-id title) fail CI; clean PRs pass.
  - Checks are documented; `pnpm check` stays green.

### B-040 — Riot policy check (live-phase gate)

- **Milestone:** M0 · **Size:** S · **Status:** TODO · **Decision IDs:** D-105, D-007
- **Goal:** Determine whether reading LCU + Live Client Data for advice is permitted before building it.
- **Content:**
  - Read Riot's third-party developer policy / relevant terms on local API usage and in-game assistance tools. Record findings in a new DECISIONS.md entry (PROPOSED → owner decides) with **links to the exact policy passages** (URLs + section anchors + short quotes) and the date checked.
  - Add an explicit note that **the owner must read the linked passages themselves; an AI summary alone is not sign-off**.
  - State a clear GO/NO-GO verdict per data source (LCU, Live Client Data API); if NO-GO, M3 scope reduces to manual input + screenshot fallback evaluation.
- **Dependencies:** none (can run any time; must precede B-041/B-042).
- **Out of scope:** implementing any client reading.
- **Acceptance tests:**
  - DECISIONS.md entry cites the exact policy pages/sections checked, quotes the relevant passages, and records the date.
  - Entry states a clear verdict per data source (LCU, Live Client Data API) and includes the owner-read requirement.
  - Owner sign-off recorded before B-041/B-042 start.

---

## M1 — Version 1: the pick screen

Scope per GOALS.md/D-100: pick screen for SUPPORT, TOP, JUNGLE in full; ADC and Mid at champion-level statistics only; manual draft and bans; enemy-role inference with override; pool editor (champion x roles, stored by the program); "From your pool" above "Best overall" with In-pool tags and both ranks; thin-data fallback; personal-record badge; unvalidated label; public patch name; light/dark toggle; portraits; manual input fast enough for live picks.

**Rollout order:** v1a is SUPPORT-only — the first usable build exposes only SUPPORT even though the engine remains role-generic. TOP/JUNGLE are enabled role-by-role in v1b only after B-011's per-file sample-size evidence and owner confirmation; ADC/MID minimal follows B-024. If B-014's owner choice is "champion-level statistics only", the pick screen ships stats without a ranked list.

### B-010 — Desktop app scaffold + launch data download

- **Milestone:** M1 · **Size:** L → split into B-010a/B-010b · **Status:** TODO · **Decision IDs:** D-099, D-107, D-108
- **Goal:** A Windows app that starts fast, downloads the latest aggregates at launch with no token, and hosts the pick screen.
- **Split:**
  - **B-010a (M) · Status: TODO:** Tauri shell + app skeleton (navigation, theme plumbing, settings storage). Reuses `packages/engine`/`shared` as-is; UI approach follows the existing web app's conventions where portable (audit §2.7: `data/loader.ts` is the most reusable part). v1a exposes SUPPORT only; role enablement is data-driven for v1b.
  - **B-010b (M) · Status: TODO:** Download-at-launch module: fetch `latest.json` → manifest → per-file JSON from the public release asset (B-004), verify sha256 from the manifest, cache locally for offline use, surface freshness/patch in the UI. No token, no private repo access.
- **Dependencies:** B-002 (spike GO), B-003, B-004, B-014 (backtest verdict / owner choice on stats-only vs unvalidated ranking).
- **Out of scope:** pick-screen features (B-011+), rune/item screens, LCU/Live Client (M3).
- **Acceptance tests:**
  - App launches on Windows 11, shows patch name + data freshness, and reaches interactive within the B-002 confirmed threshold.
  - v1a role selector exposes SUPPORT only; TOP/JUNGLE stay disabled until B-011 evidence + owner enablement; the chosen B-014 behavior (stats-only vs unvalidated ranking) is reflected in the pick screen.
  - With network: latest patch data downloads and validates against manifest hashes; with network disabled after first run: cached data loads and a stale-data notice shows.
  - No token/credential is required or stored; a test greps the bundle/config for token usage.
  - `pnpm check` green incl. Windows CI job.

### B-011 — Export TOP and JUNGLE with per-file sample-size checks

- **Milestone:** M1 · **Size:** M · **Status:** TODO · **Decision IDs:** D-097
- **Goal:** Produce the TOP and JUNGLE role exports from existing aggregates and gate them on real sample sizes.
- **Content:**
  - Extend `pnpm etl export` role list to include TOP and JUNGLE (aggregates already exist for all roles — AUDIT §5c; no re-aggregation needed). This gates v1b role enablement; v1a SUPPORT does not wait for it.
  - Per-file sample-size report: for every exported file under `roles/TOP/` and `roles/JUNGLE/`, record row counts and `n_eff` distribution; a role's UI enablement is driven by this report (thresholds to be set from the report, marked as needing owner confirmation if they become a gate). Enable TOP and JUNGLE role-by-role only after their files pass.
  - Keep ADC/MID at champion-level statistics only (pick-rate/baseline level); do not export pair/lane layers for them.
- **Dependencies:** B-004 (publish path must carry the new role dirs).
- **Out of scope:** re-aggregation; changing weights; UI (B-010a consumes the manifest `roles` list).
- **Acceptance tests:**
  - `data/public/<patch>/roles/TOP/` and `roles/JUNGLE/` exist with the same file layout as SUPPORT; `manifest.roles` lists them.
  - A report (committed under `docs/reports/` or printed by a command) shows per-file row counts and min/median `n_eff` for TOP and JUNGLE.
  - Files below `exportMinGames` contain no rows (existing gate still enforced); a test asserts the export validates against shared schemas.
  - UI role enablement rule is documented: a role appears selectable only when its export passes the agreed sample-size check.

### B-012 — Bans in the draft input contract

- **Milestone:** M1 · **Size:** M · **Status:** TODO · **Decision IDs:** D-106
- **Goal:** Implement `bans` end-to-end in schema, engine and UI.
- **Content:**
  - Add `bans?: ChampionId[]` to `draftInputSchema` (`packages/shared/src/schemas/draft.ts` — currently `.strict()` without it; SPECS §2 already declares it).
  - Engine: banned champions are excluded from the candidate set and from enemy role assignment (§4 inference treats them as unavailable); a ban on an already-picked champion is a validation/usage error surfaced to the UI, not a crash.
  - UI: manual bans input on the pick screen (pick/ban toggle or dedicated bans row), fast enough for live use (pairs with B-022).
- **Dependencies:** B-010a (app scaffold). Engine part can land independently.
- **Out of scope:** ban phase auto-detection (M3 LCU); changing scoring math.
- **Acceptance tests:**
  - Unit tests: a banned champion never appears in `recommendations`, `poolRecommendations`, or `insufficientData` unless it was already picked; enemy role inference never assigns a banned champion a role it would have gotten.
  - `DraftResult` determinism preserved (same input → same output); `schemaVersion` bumped if the output shape changes.
  - SPECS §2/§4/§5 updated in the same PR; UI test: entering a ban removes that champion from results.
  - Sample sizes unchanged for unaffected champions (regression test on a fixture draft).

### B-013 — Evidence rule in aggregation (D-102)

- **Milestone:** M1 · **Size:** L → split into B-013a/B-013b · **Status:** TODO · **Decision IDs:** D-102, D-022, D-021, D-045, D-023
- **Goal:** Per-player cap, minimum distinct players, win rate and pick share shown separately, Master+ toggle off by default — with values set by the backtest, not guesses.
- **Split:**
  - **B-013a (L → split before work) · Status: TODO:** Implement the mechanism in aggregation + shared schemas + engine display fields: per-player weight cap within a context, distinct-player count per row, separate `winRate`/`pickShare` fields, `masterPlusOnly` option (default off). New parameters live in config as priors. Split before work into an aggregation/schema half and an engine/display half.
  - **B-013b (M) · Status: TODO:** Run the D-023 backtest to choose the cap and minimum-distinct-player values; record the chosen values and the report link in DECISIONS.md (amend D-102 with the measured values) and SPECS §3.
- **Dependencies:** B-013a before B-013b; B-013b before M2 rune/item tickets that display these numbers. B-013b reuses the backtest harness/report conventions from B-014 (M0) but does not gate v1a.
- **Out of scope:** applying the rule to the draft pick ranking itself (D-102 scopes it to runes/summoners/items evidence; draft keeps broad data).
- **Acceptance tests:**
  - Aggregation tests: a synthetic context dominated by one player shows the capped weight and the distinct-player count; below the minimum the row is suppressed or flagged, never shown as a bare number.
  - Export schema carries `distinctPlayers` (or equivalent) and separate win-rate/pick-share fields; `pnpm etl validate-export` passes.
  - B-013b: a backtest report exists under `docs/reports/` (or `data/reports/`) with the measured cap/min values and the gate result; values in config match the report.
  - SPECS §3/§8 updated; no PROPOSED decision implemented.

### B-015 — Enemy role inference UI: confidence + override

- **Milestone:** M1 · **Size:** M · **Status:** TODO · **Decision IDs:** D-104, D-050
- **Goal:** Show inferred enemy roles with confidence and let the player override.
- **Content:**
  - Surface the engine's §4 inference output (per-slot role, confidence) in the UI for enemy slots entered without roles; confidence visually distinct from fixed/override roles.
  - Per-slot role dropdown as manual override (confidence 1 per SPECS §4); override persists for the draft session and recomputes recommendations.
  - Banned champions never participate in inference (B-012).
- **Dependencies:** B-010a, B-012 (bans excluded from assignment).
- **Out of scope:** ally role inference UI (allies' roles are known per GOALS.md); auto-detection.
- **Acceptance tests:**
  - UI test: enemy slot without role shows inferred role + confidence; changing the dropdown overrides and recomputes the list.
  - Engine already tested (`roles.test.ts`); add UI-level test that confidence-1 override path matches engine behavior.
  - Accessibility: role controls keyboard reachable.

### B-016 — Champion pool: program-stored champion x roles editor + lists UI

- **Milestone:** M1 · **Size:** L → split into B-016a/B-016b · **Status:** TODO · **Decision IDs:** D-101, D-024, D-053, D-114
- **Split:**
  - **B-016a (M) · Status: TODO:** Pool storage in the program (not localStorage/browser): per-role champion x roles model, `poolMaxSize` per role (default 40), corruption/absence resilience per SPECS §2.1, JSON export/import compatible with the `data/pool.config.json` hand-off defined by B-006, including the D-114 "Export to repo file" action and the warning when the in-app pool and repo file differ.
  - **B-016b (M) · Status: TODO:** Recommendation lists UI: "From your pool" above "Best overall", "In pool"/"In your pool" tags, both ranks on pool cards (`poolRank` + global `rank`), "Show more" pagination (first 5, then +5), "Showing X of Y", "Hide my pool" toggle, unavailable-pool-champion cards with reasons.
- **Dependencies:** B-010a, B-006 (pool hand-off contract); B-016b needs the engine `poolRecommendations` contract (already implemented — verify, don't rewrite).
- **Out of scope:** favorites auto-import (D-074, v2); pool sync across devices.
- **Acceptance tests:**
  - Pool survives app restart; stored outside any webview storage the OS might clear; corrupt/missing file → empty pool + visible notice, never a crash.
  - Champion x roles editor: pick champion once, tick roles; same champion can appear under multiple roles.
  - UI tests: empty pool shows CTA + Best overall; non-empty pool shows both lists with correct tags/ranks; pagination reveals all items; pool never changes `score(c)` (engine regression test).
  - SPECS §2.1/§7.1 unchanged or updated if storage location wording changes.

### B-017 — Thin-data fallback (D-103)

- **Milestone:** M1 · **Size:** S · **Status:** TODO · **Decision IDs:** D-103, D-054, D-087
- **Goal:** When pick data is thin, show a broader labeled statistic instead of nothing.
- **Content:**
  - For champions failing the baseline `n_eff` gate, show the broader statistic (e.g. champion win rate / pick share in that role) clearly labeled as broader; never a prior-only 50% (golden rule 8).
  - Insufficient-data cards keep `nEff`/`rawGames`/`winRate` per SPECS §7; `winRate` shown only when weighted evidence exists.
- **Dependencies:** B-010a. v1a SUPPORT uses the already-exported SUPPORT broader stats; TOP/JUNGLE thin-data fallback waits for B-011.
- **Out of scope:** item/rune fallbacks (M2/M3).
- **Acceptance tests:**
  - Unit/UI test: a champion below `minGames` renders the labeled broader statistic with its own sample size, not a score.
  - A champion with zero evidence renders "insufficient data" with n=0, no fabricated number.
  - SPECS §7 thin-data paragraph verified against implementation.

### B-018 — Personal record badge (D-100/D-075)

- **Milestone:** M1 · **Size:** S · **Status:** TODO · **Decision IDs:** D-100, D-075, D-097
- **Goal:** Show the player's own record on each champion card as a badge only.
- **Content:**
  - Per-champion badge "You: N games, X%" from profile data; "not enough data" below the minimum sample.
  - Badge never changes ranking or scores; profile scope covers SUPPORT/TOP/JUNGLE per D-097 (fix any SUPPORT-only assumption carried from D-072).
- **Dependencies:** B-010a, B-006 (profile hand-off contract). Refresh the stale `profiles/` export via `pnpm etl profile-sync` + export when producing the local file; absent/invalid file → badge "no data".
- **Out of scope:** blended "my results" ranking (v2, D-089 pending); personalized list.
- **Acceptance tests:**
  - Badge shows games + win rate with sample size; below minimum shows "not enough data".
  - Removing profile data does not break the screen (badge hidden or "no data").
  - Badge presence does not alter `recommendations` order (test).

### B-019 — Public patch name display (D-108)

- **Milestone:** M1 · **Size:** S · **Status:** TODO · **Decision IDs:** D-108, D-043
- **Goal:** Show the public patch name (26.x) verified against a real mapping, not a guessed offset.
- **Content:**
  - **First: verification.** Check the 16.x → 26.x mapping against at least one more anchor beyond 16.22↔26.22 (AUDIT §5b verified only the current patch; e.g. confirm an older patch pair via Data Dragon `versions.json` + official patch notes). Record the verified rule (or "unverified, show internal label") in DECISIONS.md.
  - Then implement display mapping in the app; internal data keeps `major.minor`.
- **Dependencies:** B-010a for display; verification can start immediately.
- **Out of scope:** changing stored patch labels or `patch_index` logic.
- **Acceptance tests:**
  - DECISIONS.md records the verification method, anchors checked, and the resulting rule — or an explicit "mapping unverified, display internal label" fallback.
  - UI shows the public name for the current patch and handles unknown mappings gracefully.
  - No code path compares version strings for ordering (SPECS §12 invariant).

### B-020 — Light/dark theme toggle (D-107)

- **Milestone:** M1 · **Size:** S · **Status:** TODO · **Decision IDs:** D-107
- **Goal:** Visual direction C with a toggle that remembers the choice; first launch follows the Windows theme.
- **Content:**
  - Implement light (default direction C) + dark themes; toggle persisted by the program (same store as B-016a settings); first launch detects OS theme.
  - Applies to all v1 screens.
- **Dependencies:** B-010a.
- **Out of scope:** theme scheduling, custom themes.
- **Acceptance tests:**
  - Toggle switches theme instantly; choice survives restart.
  - Fresh profile on a dark Windows theme starts dark; on light starts light (test via mocked OS theme).
  - Contrast check on key screens documented in PR (manual verification acceptable, noted as such).

### B-021 — Champion portraits beside names (D-053)

- **Milestone:** M1 · **Size:** S · **Status:** TODO · **Decision IDs:** D-053
- **Goal:** Portraits next to champion names everywhere on the pick screen.
- **Content:**
  - Load Data Dragon icons (existing CDN approach from the web app); graceful fallback (initials/placeholder) when offline or missing.
  - Apply to recommendation cards, draft slots, pool editor, ban list.
- **Dependencies:** B-010a.
- **Out of scope:** custom artwork, video/animation.
- **Acceptance tests:**
  - Portraits render for all champion lists; missing icon shows fallback, never a broken image or crash.
  - Offline mode uses cached icons or fallback.

### B-022 — Fast manual draft input

- **Milestone:** M1 · **Size:** M · **Status:** TODO · **Decision IDs:** D-104, GOALS.md "Fast"
- **Goal:** Entering a full draft (allies, enemies, bans, role overrides) is fast enough to use between live picks.
- **Content:**
  - Keyboard-first champion search (SPECS §10 accessibility), quick role assignment, one-keystroke slot navigation, ban toggle.
  - Target: a practiced user completes a 10-slot + bans draft without touching the mouse. Measure and record time-on-task in the PR (manual test, documented).
- **Dependencies:** B-010a, B-012, B-015.
- **Out of scope:** auto-detection (M3); gesture/controller support.
- **Acceptance tests:**
  - All draft fields reachable and editable by keyboard alone.
  - PR documents a timed manual test (e.g. ≤ ~60 s for a full draft — **estimate, owner to confirm**).
  - Recommendations update incrementally as slots fill (no full recompute stall; engine < 50 ms per SPECS §10).

### B-023 — Pool-driven collection (D-102)

- **Milestone:** M1 · **Size:** M · **Status:** TODO · **Decision IDs:** D-102, D-094, D-114
- **Goal:** Prioritize ingesting pending players who play the player's pool champion×role pairs, so rune/item evidence for the pool improves.
- **Content:**
  - Selection logic in match ingestion (`--limit` ordering today is rank-only, AUDIT §5d): pending players whose stored `participants` rows include pool champion×role pairs get priority. Pool pairs are read **only** from the committed `data/pool.config.json` defined by B-006/D-114 (public-safe champion×role pairs only); the pipeline never reads the program's pool store and adds no network calls.
  - Document the effect: which pending players get picked and why (log line per selection).
- **Dependencies:** B-006 (pool hand-off contract), B-016a (program pool store exists for export/editing); ETL pipeline unchanged otherwise (D-094/D-098 keep it).
- **Out of scope:** new Riot endpoints; changing quotas or discovery; draft-ranking data (D-102 keeps draft on broad data).
- **Acceptance tests:**
  - Unit test: given a pending-player set and a `data/pool.config.json`, selection order prioritizes players with matching `participants` rows; players without matches fall back to rank order; the program pool store and network are not consulted.
  - `--dry-run`/log shows the priority reason per selected player.
  - No behavior change when no pool is configured (byte-identical selection to today — regression test).

### B-024 — ADC and Mid minimal: champion-level statistics

- **Milestone:** M1 · **Size:** S · **Status:** TODO · **Decision IDs:** D-097
- **Goal:** ADC/MID users get champion-level statistics only (no pair/lane layers).
- **Content:**
  - Ensure baseline + pick-rate exports exist for ADC/MID (baseline rows already exist per AUDIT §5c; verify pick-rate coverage), and the UI offers ADC/MID as "minimal" roles showing win rate / pick share with sample sizes — no synergy/counter claims.
  - Clearly label the minimal mode in UI copy.
- **Dependencies:** B-011 (export machinery), B-010a. This is v1b/later scope — not required for the SUPPORT-only v1a build.
- **Out of scope:** pair/lane exports or scoring for ADC/MID; tuning beyond champion-level stats (GOALS non-goal).
- **Acceptance tests:**
  - ADC/MID selectable in UI; results show champion-level stats with `n_eff`/sample sizes and the "minimal" label.
  - No pair/lane reason types appear for ADC/MID.
  - `manifest.roles` or role metadata distinguishes full vs minimal roles.

### B-025 — Windows build and install artifact from CI

- **Milestone:** M1 · **Size:** M · **Status:** TODO · **Decision IDs:** D-099, D-110
- **Goal:** Produce a downloadable Windows 11 install artifact so another player (or the owner) can install without building from source.
- **Content:**
  - CI job on `windows-latest` builds the desktop app into an installer artifact (Tauri bundler output — NSIS/MSI per B-002's chosen configuration) and uploads it as a release artifact.
  - Document install steps (download, run installer, first-launch data download) in `docs/SETUP.md` or a dedicated install doc.
  - Note the unsigned-binary warning: without a code-signing certificate Windows SmartScreen may warn; document the expected warning and the safe way to proceed (no paid signing — free constraint).
- **Dependencies:** B-010a, B-010b, B-002 (spike GO), B-003 (Windows CI).
- **Out of scope:** code signing, auto-update, macOS/Linux builds.
- **Acceptance tests:**
  - CI produces a Windows installer artifact attached to a release or workflow artifact; a clean Windows 11 machine can install and launch it.
  - Install doc lists steps and the unsigned-binary/SmartScreen warning.
  - Artifact build is reproducible from CI config; no secrets in the artifact.

### B-026 — Sharing guide for another player

- **Milestone:** M1 · **Size:** S · **Status:** TODO · **Decision IDs:** D-096, D-099, D-101, D-102, D-114
- **Goal:** Let another player use the shared code with their own data, without exposing the owner's profile or pool.
- **Content:**
  - Write a sharing guide (e.g. `docs/SHARING.md` or a SETUP section): public aggregates need no Riot key; `profile-sync` needs the player's own Riot developer key stored locally in `.env` (never committed).
  - Explain how to set their pool: in-app pool editor (B-016) for the program and `data/pool.config.json` (B-006) for the scheduled pipeline.
  - Explain how to provide their profile: choose the local profile-export folder (B-006); absent file → "no data" badge.
  - Add an explicit first-run step: replace `data/pool.config.json` and the profile config/profile-export folder with their own before using the app.
  - State the privacy boundary plainly: code and public aggregates are shareable; profile data, PUUIDs and the SQLite DB are not.
- **Dependencies:** B-006, B-010a, B-016a/b, B-018, B-025.
- **Out of scope:** multi-user accounts, hosted service, syncing profiles between players.
- **Acceptance tests:**
  - Guide exists, is accurate against the implemented flows, and contains no secrets or owner-identifying data.
  - A second person can follow it to install (B-025), set pool/profile, and see the pick screen with their own data or "no data".

---

## M2 — Version 2: runes, summoners, starters

### B-030 — Runes screen (top players / my data)

- **Milestone:** M2 · **Size:** L → split · **Status:** TODO · **Decision IDs:** D-102, D-022, D-059, D-097
- **Split:**
  - **B-030a (M) · Status: TODO:** Runes data path: context computation (§8.1) + export consumption + evidence rule display (cap, distinct players, WR vs pick share separate, Master+ toggle off).
  - **B-030b (M) · Status: TODO:** Runes UI: two modes (top players / my data), top-3 pages + adaptation hints, sample sizes on every number, thin-data broader-statistic fallback (D-103).
- **Dependencies:** B-013b (evidence values), B-014 report from M0 before trusting numbers; B-010a.
- **Out of scope:** per-rune usefulness personalization ("Later" in GOALS.md).
- **Acceptance tests:**
  - Every shown win rate/pick share carries sample size + distinct-player count; Master+ toggle defaults off and is labeled optional.
  - Thin context falls back to broader statistic, labeled (D-103).
  - Mode switch re-queries without restart; both modes show their data source.

### B-031 — Summoners and starters (top players / my data)

- **Milestone:** M2 · **Size:** L → split · **Status:** TODO · **Decision IDs:** D-102, D-097, D-106 (Top TP quest check)
- **Split:**
  - **B-031a (M) · Status: TODO:** Summoner-spell recommendation data + engine path for SUPPORT/TOP/JUNGLE; include the D-106 check on Top's Teleport quest upgrade effect on summoner advice (record finding in DECISIONS.md).
  - **B-031b (M) · Status: TODO:** UI for summoners + starting items, both modes, sample sizes, thin-data fallback.
- **Dependencies:** B-013b, B-030a (shared evidence plumbing).
- **Out of scope:** in-game item advice (M3).
- **Acceptance tests:**
  - Same evidence-rule display rules as B-030; starter items use `starterWindowSeconds` bundle definition (D-086 kept as design direction — **PROPOSED: needs owner OK before implementation**, per D-109).
  - Top quest/TP finding documented; if it changes advice, SPECS updated.

### B-032 — Remove SUPPORT-only filters in personalization

- **Milestone:** M2 · **Size:** M · **Status:** TODO · **Decision IDs:** D-097, D-073, D-074
- **Goal:** Personalization (profile setup, favorites) works for SUPPORT, TOP, JUNGLE.
- **Content:**
  - Remove `role !== 'SUPPORT'` filters in `personalize.ts`/`profile-setup.ts` (audit §2.5); role-generic per D-020/D-021.
  - Refresh the stale profile export (AUDIT §4.3: `gameCount: 0` vs 278 stored games) via `profile-sync` + export before shipping UI that depends on it.
- **Dependencies:** B-030a/B-031a context; profile pipeline (ETL, kept per D-098).
- **Out of scope:** blended ranking (B-033); new profile features.
- **Acceptance tests:**
  - Tests cover TOP and JUNGLE personalization paths; SUPPORT regression tests still pass.
  - Profile export `gameCount` matches `profile_games` row count after refresh.
  - SPECS §18 updated if role wording changes.

### B-033 — Blended "my results" ranking — ONLY if D-089 approved

- **Milestone:** M2 · **Size:** M · **Status:** BLOCKED · **Decision IDs:** D-089 (PROPOSED — owner approval required), D-100, D-072
- **Goal:** Optional blended ranking of meta + personal results.
- **Content:**
  - Implement `blendMode: 'logit'` personalization blend **only after** the owner explicitly approves D-089 (D-109: no PROPOSED decision is auto-approved).
  - Until approval: ticket stays BLOCKED; do not implement `rankNorm`→`logit` changes.
- **Dependencies:** owner approval of D-089; B-032.
- **Out of scope:** anything if D-089 is rejected.
- **Acceptance tests:**
  - If approved: tests show log-odds blending matches spec; UI labels the blended list per D-072 (profile label, never "For you"); sample sizes shown.
  - PR description quotes the owner's D-089 approval.

---

## M3 — Version 3: in-game items + auto-fill

**Gate:** B-040 (M0) must record a GO verdict and owner sign-off before any live-data ticket (B-041/B-042) starts; if it forbids the approach, M3 auto-fill scope reduces to manual input + screenshot fallback evaluation. All items decisions (D-081..D-086, D-093 kept as design direction; D-082/D-087/D-095 folded into the rewrite; D-109) need explicit owner OK when this phase starts.

### B-041 — LCU champ select reading

- **Milestone:** M3 · **Size:** L → split · **Status:** TODO · **Decision IDs:** D-105, D-106, D-007
- **Split:**
  - **B-041a (M) · Status: TODO:** LCU client module (lockfile auth, champ-select session polling) feeding the draft input; manual input remains as fallback.
  - **B-041b (M) · Status: TODO:** UI integration: auto-filled draft with visible "auto" state, one-click confirm, ban capture (D-106 bans come from the draft screen).
- **Dependencies:** B-040 GO verdict + owner sign-off; B-012 (bans contract); B-010a.
- **Out of scope:** writing to the client (no input injection — SPECS §9); rank auto-detection.
- **Acceptance tests:**
  - With the League client in champ select, draft fields populate automatically; user can override any field.
  - Client closed/crashed → manual input path unaffected; no crash, no hang (timeout + error state).
  - No memory reading or input injection anywhere (code review checklist item).

### B-042 — Live Client Data API reading

- **Milestone:** M3 · **Size:** L → split · **Status:** TODO · **Decision IDs:** D-105, D-081 (PROPOSED)
- **Split:**
  - **B-042a (M) · Status: TODO:** LCD polling module (`127.0.0.1:2999/liveclientdata/allgamedata`) → `GameState` mapping; gold unavailability handled per D-105 (win/lose/even is an estimate).
  - **B-042b (M) · Status: TODO:** In-game screen shell: game state display, missing-field warning borders, manual fill-in.
- **Dependencies:** B-040 GO verdict + owner sign-off; B-042a before B-043..B-047.
- **Out of scope:** writing to the client; third-party overlays.
- **Acceptance tests:**
  - During a practice-tool game, player KDA/items/level populate; all 9 other players' publicly exposed fields populate; gold-dependent fields show "estimate" labeling.
  - API unreachable (not in game) → clean idle state, no errors.

### B-043 — Role-quest slot model (D-106)

- **Milestone:** M3 · **Size:** L → split · **Status:** TODO · **Decision IDs:** D-106, D-082, D-083 (folded, PROPOSED — owner OK needed)
- **Split:**
  - **B-043a (M, research spike) · Status: TODO:** Inventory which role-quest facts already exist in stored data before writing any extraction code. Check `item_events`, `participant_challenges`, `lane_snapshots`, `participant_starters` and related timeline-derived fields for: ADC boots as a 7th slot, Mid free tier-3 boots, Support control-ward slot (up to 2), and Top Teleport quest upgrade. No schema or pipeline changes.
  - **B-043b (L → split before work) · Status: TODO:** Data model + extraction for the role quests, implementing only the facts B-043a proved exist (or logging the rest as unavailable). Split before work into schema/migration and extraction halves.
  - **B-043c (M) · Status: TODO:** Aggregation/export changes so `item_build`/build-paths reflect quest slots per the D-106 display rule (≤6 items incl. boots; ADC boots as 7th after quest).
- **Dependencies:** B-043a can run as soon as M3 planning starts (data-side, no live client); B-043b needs B-043a + owner OK on folded PROPOSED decisions; B-043c needs B-043b. B-040 is not required for the data-side work but the M3 phase gate still applies.
- **Out of scope:** the items recommendation engine itself (B-044).
- **Acceptance tests:**
  - **B-043a:** a written report (e.g. `docs/reports/role-quest-data-audit.md`) lists, per role quest, which facts exist in the stored data and which do not, with the queries/sample counts used — no guessing.
  - **B-043b:** new schema fields/tables migrated cleanly on a copy of the DB; existing exports still validate; extraction covers only facts proven present.
  - **B-043c:** fixture match per role quest produces the documented slot layout; display rule verified in export JSON; sample sizes reported per new context dimension.

### B-044 — Items engine rewrite (v3)

- **Milestone:** M3 · **Size:** L → split · **Status:** TODO · **Decision IDs:** D-103, D-093, D-082..D-087, D-095 (PROPOSED — owner OK needed), D-102
- **Split:**
  - **B-044a (L → split before work) · Status: TODO:** Core recommender: like-for-like backoff + analytic fallback (D-093 design direction), win/lose/even scenarios, evidence rule display, labeled rule fallback when data is thin. Split before work into a backoff/context half and an analytic-fallback/scenarios half.
  - **B-044b (L → split before work) · Status: TODO:** Backtest/calibration for item contexts (D-023 gate philosophy); build plans; `avoid` list. Split before work into a backtest/calibration half and a build-plans/avoid half.
- **Dependencies:** B-043c, B-044a before B-044b, B-042, B-013b, owner approval of PROPOSED item decisions.
- **Out of scope:** sell advice (B-046), fed option (B-045) — separate tickets.
- **Acceptance tests:**
  - Given a `GameState`, output 1–3 items + reasons + sample sizes; thin data → labeled analytic fallback, never invented numbers.
  - Win/lose/even scenarios produce visibly different recommendations on a fixture.
  - Golden tests for at least SUPPORT and TOP item paths.

### B-045 — Fed enemy/ally option

- **Milestone:** M3 · **Size:** S · **Status:** TODO · **Decision IDs:** D-105, D-081 (PROPOSED)
- **Goal:** Player can mark any champion as fed to steer item advice.
- **Content:** Manual "fed" toggle per champion in the game screen; feeds the threat/profile weighting (D-081 threat score — PROPOSED, owner OK needed).
- **Dependencies:** B-044, B-042.
- **Acceptance tests:**
  - Marking a fed enemy changes the recommendation reasons and item order on a fixture; unmarking reverts deterministically.
  - Fed ally supported symmetrically per GOALS.md.

### B-046 — Sell advice

- **Milestone:** M3 · **Size:** M · **Status:** TODO · **Decision IDs:** D-106, D-103
- **Goal:** Advise which owned items to sell for the current situation.
- **Content:** Rule + data hybrid per D-103; respects quest-slot items (never suggest selling quest-line items); shows reason + sample size or "rule" label.
- **Dependencies:** B-044 (a/b halves complete), B-043c.
- **Acceptance tests:**
  - Fixture states produce sell suggestions with reasons; quest items never suggested; thin data → labeled rule.
  - Suggestions reference only items the player owns.

### B-047 — Warning borders for missing fields

- **Milestone:** M3 · **Size:** S · **Status:** TODO · **Decision IDs:** GOALS.md "Game screen", D-105
- **Goal:** Only the player's own champion is mandatory; any missing field shows a warning border and can be filled later.
- **Content:** Visual warning treatment on incomplete `PlayerState`/`GameState` fields; manual edit fills them; auto-fill (B-042) clears the warning when data arrives.
- **Dependencies:** B-042b.
- **Acceptance tests:**
  - Each missing field type shows the warning border; filling it (manual or auto) removes it; recommendations still compute with partial data or show an explicit "insufficient input" state — never crash.

---

## Critical path and suggested order

**Critical path:** B-001 → B-014 (real backtest + owner choice on stats-only vs unvalidated ranking) → B-002 (spike GO/NO-GO) → B-003 + B-004 (Windows CI + public aggregates) → B-010a/b (v1a SUPPORT-only app + launch data) → B-012/B-015/B-016/B-018/B-025 (core pick-screen interactions + personal data + install artifact) → B-011/B-024 (v1b TOP/JUNGLE and ADC/MID enablement) → M2/M3 gates. B-040 (M0) runs in parallel and gates B-041/B-042; B-005/B-006/B-007/B-008 are M0 support work that can proceed alongside the path.

**First five tickets (suggested order):**

1. **B-001** — decisions D-110..D-113 (unblocks everything; S).
2. **B-014** — real draft backtest report + owner choice if the D-023 gate fails again (M0, right after B-001).
3. **B-002** — Tauri spike (gates the whole app language; needs Windows hardware/CI).
4. **B-003** — Windows CI + better-sqlite3 check (parallel with B-002).
5. **B-004** — public aggregates + size budget (unblocks B-010b and all data display).

B-005 (joint-model deletion/doc fixes), B-006 (personal data hand-off), B-007 (DB growth report), B-008 (CI safety) and B-040 (Riot policy) are M0 work that can run in parallel; none blocks v1a except B-006 for B-018/B-023 and B-040 for M3 live data.

## Tickets depending on an owner decision

| Ticket     | Blocked on                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-014      | If the D-023 gate fails again, owner chooses "champion-level statistics only" vs "ranking with the unvalidated label" before B-010 scope is fixed |
| B-002      | Owner confirmation of spike thresholds after measurement (estimates: start < ~3 s, idle mem < ~400 MB)                                            |
| B-006      | Owner confirms the private profile path and the public `pool.config.json` boundary before B-018/B-023 implementation                              |
| B-007      | Alert threshold and retention/prune plan are a PROPOSED decision; no deletion without owner approval                                              |
| B-010a/b   | B-002 GO verdict on D-110 + B-014 owner choice (stats-only vs unvalidated ranking)                                                                |
| B-013a/b   | Values are set by backtest (B-013b); mechanism parameters are priors until then                                                                   |
| B-025      | Unsigned-binary/SmartScreen warning accepted as the shipping state (no paid signing)                                                              |
| B-031a/b   | D-106 is accepted, but starter-bundle design direction D-086 is PROPOSED — owner OK required                                                      |
| B-033      | D-089 PROPOSED — explicit owner approval required; BLOCKED until then                                                                             |
| B-040      | Owner must read the linked policy passages; B-041/B-042 blocked on GO verdict + owner sign-off                                                    |
| B-043a/b/c | B-043a is research-only; B-043b/c and the items engine need owner OK on folded PROPOSED decisions at M3 start (D-109)                             |
| B-044a/b   | PROPOSED item decisions (D-081..D-087, D-093, D-095) need owner OK at M3 start (D-109)                                                            |
| B-045      | D-081 PROPOSED — owner OK needed                                                                                                                  |
| B-019      | Verification may conclude "unverified → show internal label"; that fallback needs owner awareness                                                 |
| All        | No ticket implements a PROPOSED decision without owner approval (D-109, golden rule)                                                              |
