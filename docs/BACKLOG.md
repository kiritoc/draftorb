# BACKLOG — rework plan (D-098/D-099)

Status: draft for owner review. Source of truth for _what_ and _why_: `docs/GOALS.md`, `docs/DECISIONS.md` (D-096..D-109 accepted; PROPOSED entries per D-109). This file replaces `docs/TICKETS.md` (obsolete, scheduled for deletion) and defines the pull-request-sized work packages for the rework.

## How to use this file

- One ticket = one PR. Tickets are ordered by milestone; dependencies are explicit.
- Every ticket that changes behavior must, in the same PR: add/update tests, update `docs/SPECS.md` (or the relevant spec section), show sample sizes next to any new number, contain no secrets, and not implement any PROPOSED decision without owner approval.
- Size: S (< half day), M (about half a day), L (about a day — L tickets are split before work starts).
- "Unverified" marks anything not confirmed against the repo or an external source. Estimates are marked as estimates and need owner confirmation before they gate a decision.
- The change-score pipeline and breakpoints (D-046, D-047) are **not scheduled**: no ticket below uses them. `entity_change_scores` and `data_breakpoints` stay in the database unused.
- `docs/TICKETS.md` is obsolete; do not add tickets there.

## Milestones

| Milestone | Goal                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| M0        | Foundations: decisions D-110..D-113 written, Windows spike, public aggregates, joint-model deletion, doc hygiene            |
| M1        | Version 1 — the pick screen (Support, Top, Jungle in full; ADC and Mid minimal)                                             |
| M2        | Version 2 — runes, summoners and starters (top players / my data); personalization unblocked for all in-scope roles         |
| M3        | Version 3 — in-game items with automatic game-client data, sell advice, fed option (starts with the Riot policy ticket)      |

---

## M0 — Foundations

### B-001 — Write decisions D-110..D-113

- **Milestone:** M0 · **Size:** S · **Decision IDs:** D-098, D-099, D-109 (owner decisions already taken; this ticket records them)
- **Goal:** Record the four owner decisions taken on 2026-11-15 as DECISIONS.md entries, and resolve the GOALS.md open items they close.
- **Content:**
  - D-110 — Language: TypeScript engine with a Tauri shell for the Windows 11 program; the M0 spike (B-002) validates it against owner-confirmed thresholds; full Rust remains possible later.
  - D-111 — Shared aggregates are published as a public release asset (no token needed); profile data and the SQLite database stay private.
  - D-112 — Delete the joint draft model code (engine `joint/`, ETL `joint-fit`/`fit-model`, `joint-model.json` export); D-092/D-092a stay in DECISIONS.md as the record of the negative result.
  - D-113 — Keep the ETL timeline extraction and the raw data (`item_events`, `kill_events`, lane snapshots, challenges, starters); the engine items layer is a rewrite in v3; do not delete the raw tables.
  - Update GOALS.md "Open items" (language and data location resolved; patch display still open until B-019 verifies the mapping).
- **Dependencies:** none (owner decisions are already taken).
- **Out of scope:** implementing anything; the D-110..D-113 text must not smuggle in unapproved PROPOSED decisions.
- **Acceptance tests:**
  - `docs/DECISIONS.md` contains D-110..D-113, each marked ACCEPTED with the owner date, and each names the decision(s) it amends or resolves.
  - `docs/GOALS.md` open items reflect the resolved items; no contradiction between GOALS.md, DECISIONS.md and AUDIT.md §8 answers.
  - `pnpm check` passes (docs-only change).

### B-002 — Windows 11 Tauri spike: empty shell + engine benchmark

- **Milestone:** M0 · **Size:** M · **Decision IDs:** D-098, D-099, D-110
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

- **Milestone:** M0 · **Size:** S · **Decision IDs:** D-098, D-099
- **Goal:** Make Windows a first-class CI target for the desktop work and verify the riskiest native dependency.
- **Content:**
  - CI job on `windows-latest` (Node 22): install, `pnpm check`, and — once B-002 lands — build the Tauri spike.
  - Verify `better-sqlite3` loads from its prebuilt binary on Windows Node 22 (AUDIT.md §5j verified the prebuilds exist in the package; this ticket proves they load in CI).
  - Document any Windows-only failures in `docs/BUGS.md`.
- **Dependencies:** B-001. (Can run in parallel with B-002; the Tauri build step waits for B-002.)
- **Out of scope:** macOS/Linux-specific fixes; ETL-on-Windows end-to-end (unverified per AUDIT §5j — log as a bug, don't fix here).
- **Acceptance tests:**
  - A `windows-latest` CI job exists, is green, and runs `pnpm check`.
  - CI output or a test asserts `better-sqlite3` opens a database on Windows without a compiler toolchain.
  - Results (pass/fail per step) are recorded in the PR description.

### B-004 — Public release of shared aggregates + data-size budget

- **Milestone:** M0 · **Size:** M · **Decision IDs:** D-099, D-111, D-096
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

- **Milestone:** M0 · **Size:** M · **Decision IDs:** D-112, D-109
- **Goal:** Remove dead code whose validation gates failed, and repair the documentation contradictions found by the audit.
- **Content:**
  - Delete `packages/engine/src/joint/`, `packages/etl/src/joint-fit.ts`, `commands/fit-model.ts`, the `joint-model.json` export step, and their tests. Keep D-092/D-092a in DECISIONS.md untouched (negative-result record).
  - Remove `fit-model` from CLI help/docs; remove `joint` references from SPECS/DATA_MODEL if any.
  - Fix the stale statements in AUDIT.md §7: ARCHITECTURE.md scaffold/latest.json claims, DATA_MODEL.md SUPPORT-only line, GLOSSARY.md `exportMinGames` "unverified" note (default is 10), PROGRESS.md cron line.
- **Dependencies:** B-001 (D-112 must exist first).
- **Out of scope:** deleting `item_events`/`kill_events` or any timeline code (D-113); deleting `entity_change_scores`/`data_breakpoints` (not scheduled, but also not deleted by this ticket — leave for a later explicit decision).
- **Acceptance tests:**
  - `rg "joint|fit-model" packages apps docs` returns no code references (DECISIONS.md D-092/D-092a/D-112 entries excepted).
  - `pnpm check` green; `pnpm etl help` no longer lists `fit-model`.
  - Each AUDIT.md §7 row is either fixed or explicitly deferred with a note; `docs/PROGRESS.md` gets a handoff entry.

---

## M1 — Version 1: the pick screen

Scope per GOALS.md/D-100: pick screen for SUPPORT, TOP, JUNGLE in full; ADC and Mid at champion-level statistics only; manual draft and bans; enemy-role inference with override; pool editor (champion x roles, stored by the program); "From your pool" above "Best overall" with In-pool tags and both ranks; thin-data fallback; personal-record badge; unvalidated label; public patch name; light/dark toggle; portraits; manual input fast enough for live picks.

### B-010 — Desktop app scaffold + launch data download

- **Milestone:** M1 · **Size:** L → split into B-010a/B-010b · **Decision IDs:** D-099, D-107, D-108
- **Goal:** A Windows app that starts fast, downloads the latest aggregates at launch with no token, and hosts the pick screen.
- **Split:**
  - **B-010a (M):** Tauri shell + app skeleton (navigation, theme plumbing, settings storage). Reuses `packages/engine`/`shared` as-is; UI approach follows the existing web app's conventions where portable (audit §2.7: `data/loader.ts` is the most reusable part).
  - **B-010b (M):** Download-at-launch module: fetch `latest.json` → manifest → per-file JSON from the public release asset (B-004), verify sha256 from the manifest, cache locally for offline use, surface freshness/patch in the UI. No token, no private repo access.
- **Dependencies:** B-002 (spike GO), B-003, B-004.
- **Out of scope:** pick-screen features (B-011+), rune/item screens, LCU/Live Client (M3).
- **Acceptance tests:**
  - App launches on Windows 11, shows patch name + data freshness, and reaches interactive within the B-002 confirmed threshold.
  - With network: latest patch data downloads and validates against manifest hashes; with network disabled after first run: cached data loads and a stale-data notice shows.
  - No token/credential is required or stored; a test greps the bundle/config for token usage.
  - `pnpm check` green incl. Windows CI job.

### B-011 — Export TOP and JUNGLE with per-file sample-size checks

- **Milestone:** M1 · **Size:** M · **Decision IDs:** D-097
- **Goal:** Produce the TOP and JUNGLE role exports from existing aggregates and gate them on real sample sizes.
- **Content:**
  - Extend `pnpm etl export` role list to include TOP and JUNGLE (aggregates already exist for all roles — AUDIT §5c; no re-aggregation needed).
  - Per-file sample-size report: for every exported file under `roles/TOP/` and `roles/JUNGLE/`, record row counts and `n_eff` distribution; a role's UI enablement is driven by this report (thresholds to be set from the report, marked as needing owner confirmation if they become a gate).
  - Keep ADC/MID at champion-level statistics only (pick-rate/baseline level); do not export pair/lane layers for them.
- **Dependencies:** B-004 (publish path must carry the new role dirs).
- **Out of scope:** re-aggregation; changing weights; UI (B-010a consumes the manifest `roles` list).
- **Acceptance tests:**
  - `data/public/<patch>/roles/TOP/` and `roles/JUNGLE/` exist with the same file layout as SUPPORT; `manifest.roles` lists them.
  - A report (committed under `docs/reports/` or printed by a command) shows per-file row counts and min/median `n_eff` for TOP and JUNGLE.
  - Files below `exportMinGames` contain no rows (existing gate still enforced); a test asserts the export validates against shared schemas.
  - UI role enablement rule is documented: a role appears selectable only when its export passes the agreed sample-size check.

### B-012 — Bans in the draft input contract

- **Milestone:** M1 · **Size:** M · **Decision IDs:** D-106
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

- **Milestone:** M1 · **Size:** L → split into B-013a/B-013b · **Decision IDs:** D-102, D-022, D-021, D-045, D-023
- **Goal:** Per-player cap, minimum distinct players, win rate and pick share shown separately, Master+ toggle off by default — with values set by the backtest, not guesses.
- **Split:**
  - **B-013a (M):** Implement the mechanism in aggregation + shared schemas + engine display fields: per-player weight cap within a context, distinct-player count per row, separate `winRate`/`pickShare` fields, `masterPlusOnly` option (default off). New parameters live in config as priors.
  - **B-013b (M):** Run the D-023 backtest to choose the cap and minimum-distinct-player values; record the chosen values and the report link in DECISIONS.md (amend D-102 with the measured values) and SPECS §3.
- **Dependencies:** B-013a before B-013b; B-013b before M2 rune/item tickets that display these numbers. B-014 (backtest report) shares the harness — sequence them.
- **Out of scope:** applying the rule to the draft pick ranking itself (D-102 scopes it to runes/summoners/items evidence; draft keeps broad data).
- **Acceptance tests:**
  - Aggregation tests: a synthetic context dominated by one player shows the capped weight and the distinct-player count; below the minimum the row is suppressed or flagged, never shown as a bare number.
  - Export schema carries `distinctPlayers` (or equivalent) and separate win-rate/pick-share fields; `pnpm etl validate-export` passes.
  - B-013b: a backtest report exists under `docs/reports/` (or `data/reports/`) with the measured cap/min values and the gate result; values in config match the report.
  - SPECS §3/§8 updated; no PROPOSED decision implemented.

### B-014 — First real draft backtest report (SUPPORT, TOP, JUNGLE)

- **Milestone:** M1 · **Size:** M · **Decision IDs:** D-023, D-097, D-100
- **Goal:** Replace the empty `backtest-draft.json` placeholder with a real report and keep the "unvalidated" label honest.
- **Content:**
  - Run `pnpm etl backtest draft` for SUPPORT, TOP, JUNGLE on current data (holdout = latest patch, training = earlier patches per D-023). AUDIT §5k found a real Phase-0 run existed (log-loss 0.6967 vs baseline 0.6946 — engine worse than baseline) but was never committed; reproduce it on current data.
  - Publish the report into the export (`backtest-draft.json` populated) so the app can show validation status.
  - The "Unvalidated model" label (D-100) stays until a report passes the D-023 gate; if the gate fails, record the verdict and keep the label.
- **Dependencies:** B-011 (TOP/JUNGLE data present), B-013a/b ordering flexible but share the harness.
- **Out of scope:** tuning parameters to force a pass (D-090 `tune-priors` stays PROPOSED and unused unless the owner approves); changing the label logic without a passing report.
- **Acceptance tests:**
  - `data/public/backtest-draft.json` contains real metrics (log-loss, Brier, calibration, per-role breakdown) — not `holdoutGames: 0`.
  - Report states `validationStatus` explicitly; UI shows "unvalidated" unless status is `validated`.
  - Report file committed or linked in the PR with the command used and the data patch range.

### B-015 — Enemy role inference UI: confidence + override

- **Milestone:** M1 · **Size:** M · **Decision IDs:** D-104, D-050
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

- **Milestone:** M1 · **Size:** L → split into B-016a/B-016b · **Decision IDs:** D-101, D-024, D-053
- **Split:**
  - **B-016a (M):** Pool storage in the program (not localStorage/browser): per-role champion x roles model, `poolMaxSize` per role (default 40), corruption/absence resilience per SPECS §2.1, JSON export/import.
  - **B-016b (M):** Recommendation lists UI: "From your pool" above "Best overall", "In pool"/"In your pool" tags, both ranks on pool cards (`poolRank` + global `rank`), "Show more" pagination (first 5, then +5), "Showing X of Y", "Hide my pool" toggle, unavailable-pool-champion cards with reasons.
- **Dependencies:** B-010a; B-016b needs the engine `poolRecommendations` contract (already implemented — verify, don't rewrite).
- **Out of scope:** favorites auto-import (D-074, v2); pool sync across devices.
- **Acceptance tests:**
  - Pool survives app restart; stored outside any webview storage the OS might clear; corrupt/missing file → empty pool + visible notice, never a crash.
  - Champion x roles editor: pick champion once, tick roles; same champion can appear under multiple roles.
  - UI tests: empty pool shows CTA + Best overall; non-empty pool shows both lists with correct tags/ranks; pagination reveals all items; pool never changes `score(c)` (engine regression test).
  - SPECS §2.1/§7.1 unchanged or updated if storage location wording changes.

### B-017 — Thin-data fallback (D-103)

- **Milestone:** M1 · **Size:** S · **Decision IDs:** D-103, D-054, D-087
- **Goal:** When pick data is thin, show a broader labeled statistic instead of nothing.
- **Content:**
  - For champions failing the baseline `n_eff` gate, show the broader statistic (e.g. champion win rate / pick share in that role) clearly labeled as broader; never a prior-only 50% (golden rule 8).
  - Insufficient-data cards keep `nEff`/`rawGames`/`winRate` per SPECS §7; `winRate` shown only when weighted evidence exists.
- **Dependencies:** B-010a, B-011 (broader stats need TOP/JUNGLE pick-rate/baseline exports).
- **Out of scope:** item/rune fallbacks (M2/M3).
- **Acceptance tests:**
  - Unit/UI test: a champion below `minGames` renders the labeled broader statistic with its own sample size, not a score.
  - A champion with zero evidence renders "insufficient data" with n=0, no fabricated number.
  - SPECS §7 thin-data paragraph verified against implementation.

### B-018 — Personal record badge (D-100/D-075)

- **Milestone:** M1 · **Size:** S · **Decision IDs:** D-100, D-075, D-097
- **Goal:** Show the player's own record on each champion card as a badge only.
- **Content:**
  - Per-champion badge "You: N games, X%" from profile data; "not enough data" below the minimum sample.
  - Badge never changes ranking or scores; profile scope covers SUPPORT/TOP/JUNGLE per D-097 (fix any SUPPORT-only assumption carried from D-072).
- **Dependencies:** B-010a; profile export availability (note: current `profiles/` export is stale — AUDIT §4.3; refresh via `pnpm etl profile-sync` + export, or mark badge "no data" gracefully).
- **Out of scope:** blended "my results" ranking (v2, D-089 pending); personalized list.
- **Acceptance tests:**
  - Badge shows games + win rate with sample size; below minimum shows "not enough data".
  - Removing profile data does not break the screen (badge hidden or "no data").
  - Badge presence does not alter `recommendations` order (test).

### B-019 — Public patch name display (D-108)

- **Milestone:** M1 · **Size:** S · **Decision IDs:** D-108, D-043
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

- **Milestone:** M1 · **Size:** S · **Decision IDs:** D-107
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

- **Milestone:** M1 · **Size:** S · **Decision IDs:** D-053
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

- **Milestone:** M1 · **Size:** M · **Decision IDs:** D-104, GOALS.md "Fast"
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

- **Milestone:** M1 · **Size:** M · **Decision IDs:** D-102, D-094
- **Goal:** Prioritize ingesting pending players who play the player's pool champion×role pairs, so rune/item evidence for the pool improves.
- **Content:**
  - Selection logic in match ingestion (`--limit` ordering today is rank-only, AUDIT §5d): pending players whose stored `participants` rows include pool champion×role pairs get priority. Pool pairs come from the program's pool store (B-016a) — define the hand-off (config file or CLI arg; no network calls added).
  - Document the effect: which pending players get picked and why (log line per selection).
- **Dependencies:** B-016a (pool store exists), ETL pipeline unchanged otherwise (D-094/D-098 keep it).
- **Out of scope:** new Riot endpoints; changing quotas or discovery; draft-ranking data (D-102 keeps draft on broad data).
- **Acceptance tests:**
  - Unit test: given a pending-player set and a pool, selection order prioritizes players with matching `participants` rows; players without matches fall back to rank order.
  - `--dry-run`/log shows the priority reason per selected player.
  - No behavior change when no pool is configured (byte-identical selection to today — regression test).

### B-024 — ADC and Mid minimal: champion-level statistics

- **Milestone:** M1 · **Size:** S · **Decision IDs:** D-097
- **Goal:** ADC/MID users get champion-level statistics only (no pair/lane layers).
- **Content:**
  - Ensure baseline + pick-rate exports exist for ADC/MID (baseline rows already exist per AUDIT §5c; verify pick-rate coverage), and the UI offers ADC/MID as "minimal" roles showing win rate / pick share with sample sizes — no synergy/counter claims.
  - Clearly label the minimal mode in UI copy.
- **Dependencies:** B-011 (export machinery), B-010a.
- **Out of scope:** pair/lane exports or scoring for ADC/MID; tuning beyond champion-level stats (GOALS non-goal).
- **Acceptance tests:**
  - ADC/MID selectable in UI; results show champion-level stats with `n_eff`/sample sizes and the "minimal" label.
  - No pair/lane reason types appear for ADC/MID.
  - `manifest.roles` or role metadata distinguishes full vs minimal roles.

---

## M2 — Version 2: runes, summoners, starters

### B-030 — Runes screen (top players / my data)

- **Milestone:** M2 · **Size:** L → split · **Decision IDs:** D-102, D-022, D-059, D-097
- **Split:**
  - **B-030a (M):** Runes data path: context computation (§8.1) + export consumption + evidence rule display (cap, distinct players, WR vs pick share separate, Master+ toggle off).
  - **B-030b (M):** Runes UI: two modes (top players / my data), top-3 pages + adaptation hints, sample sizes on every number, thin-data broader-statistic fallback (D-103).
- **Dependencies:** B-013b (evidence values), B-014 ideally before trusting numbers; B-010a.
- **Out of scope:** per-rune usefulness personalization ("Later" in GOALS.md).
- **Acceptance tests:**
  - Every shown win rate/pick share carries sample size + distinct-player count; Master+ toggle defaults off and is labeled optional.
  - Thin context falls back to broader statistic, labeled (D-103).
  - Mode switch re-queries without restart; both modes show their data source.

### B-031 — Summoners and starters (top players / my data)

- **Milestone:** M2 · **Size:** L → split · **Decision IDs:** D-102, D-097, D-106 (Top TP quest check)
- **Split:**
  - **B-031a (M):** Summoner-spell recommendation data + engine path for SUPPORT/TOP/JUNGLE; include the D-106 check on Top's Teleport quest upgrade effect on summoner advice (record finding in DECISIONS.md).
  - **B-031b (M):** UI for summoners + starting items, both modes, sample sizes, thin-data fallback.
- **Dependencies:** B-013b, B-030a (shared evidence plumbing).
- **Out of scope:** in-game item advice (M3).
- **Acceptance tests:**
  - Same evidence-rule display rules as B-030; starter items use `starterWindowSeconds` bundle definition (D-086 kept as design direction — **PROPOSED: needs owner OK before implementation**, per D-109).
  - Top quest/TP finding documented; if it changes advice, SPECS updated.

### B-032 — Remove SUPPORT-only filters in personalization

- **Milestone:** M2 · **Size:** M · **Decision IDs:** D-097, D-073, D-074
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

- **Milestone:** M2 · **Size:** M · **Decision IDs:** D-089 (PROPOSED — owner approval required), D-100, D-072
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

**Gate:** the first M3 ticket (B-040) reads Riot's policy on in-game advice tools and records the result in DECISIONS.md; if it forbids the approach, M3 stops there. All items decisions (D-081..D-086, D-093 kept as design direction; D-082/D-087/D-095 folded into the rewrite; D-109) need explicit owner OK when this phase starts.

### B-040 — Riot policy check (first live-phase ticket)

- **Milestone:** M3 · **Size:** S · **Decision IDs:** D-105, D-007
- **Goal:** Determine whether reading LCU + Live Client Data for advice is permitted before building it.
- **Content:**
  - Read Riot's third-party developer policy / relevant terms on local API usage and in-game assistance tools; record findings verbatim-linked in a new DECISIONS.md entry (PROPOSED → owner decides).
  - Explicit GO/NO-GO for LCU champ-select reading and Live Client Data reading; if NO-GO, M3 scope reduces to manual input + screenshot fallback evaluation.
- **Dependencies:** none (can run any time; must precede B-041/B-042).
- **Out of scope:** implementing any client reading.
- **Acceptance tests:**
  - DECISIONS.md entry cites the exact policy pages/sections checked and the date.
  - Entry states a clear verdict per data source (LCU, Live Client Data API).
  - Owner sign-off recorded before B-041/B-042 start.

### B-041 — LCU champ select reading

- **Milestone:** M3 · **Size:** L → split · **Decision IDs:** D-105, D-106, D-007
- **Split:**
  - **B-041a (M):** LCU client module (lockfile auth, champ-select session polling) feeding the draft input; manual input remains as fallback.
  - **B-041b (M):** UI integration: auto-filled draft with visible "auto" state, one-click confirm, ban capture (D-106 bans come from the draft screen).
- **Dependencies:** B-040 GO verdict; B-012 (bans contract); B-010a.
- **Out of scope:** writing to the client (no input injection — SPECS §9); rank auto-detection.
- **Acceptance tests:**
  - With the League client in champ select, draft fields populate automatically; user can override any field.
  - Client closed/crashed → manual input path unaffected; no crash, no hang (timeout + error state).
  - No memory reading or input injection anywhere (code review checklist item).

### B-042 — Live Client Data API reading

- **Milestone:** M3 · **Size:** L → split · **Decision IDs:** D-105, D-081 (PROPOSED)
- **Split:**
  - **B-042a (M):** LCD polling module (`127.0.0.1:2999/liveclientdata/allgamedata`) → `GameState` mapping; gold unavailability handled per D-105 (win/lose/even is an estimate).
  - **B-042b (M):** In-game screen shell: game state display, missing-field warning borders, manual fill-in.
- **Dependencies:** B-040 GO; B-042a before B-043..B-047.
- **Out of scope:** writing to the client; third-party overlays.
- **Acceptance tests:**
  - During a practice-tool game, player KDA/items/level populate; all 9 other players' publicly exposed fields populate; gold-dependent fields show "estimate" labeling.
  - API unreachable (not in game) → clean idle state, no errors.

### B-043 — Role-quest slot model (D-106)

- **Milestone:** M3 · **Size:** L → split · **Decision IDs:** D-106, D-082, D-083 (folded, PROPOSED — owner OK needed)
- **Split:**
  - **B-043a (M):** Data model + extraction for role quests: ADC boots 7th slot, Mid free T3 boots, Support control-ward slot (up to 2), Top TP quest upgrade; verify what timeline/challenge facts exist (`participant_challenges`, `item_events`) — unverified parts logged, not guessed.
  - **B-043b (M):** Aggregation/export changes so `item_build`/build-paths reflect quest slots per the D-106 display rule (≤6 items incl. boots; ADC boots as 7th after quest).
- **Dependencies:** owner OK on folded PROPOSED decisions; B-040 not strictly required (data-side) but phase gate applies.
- **Out of scope:** the items recommendation engine itself (B-044).
- **Acceptance tests:**
  - New schema fields/tables migrated cleanly on a copy of the DB; existing exports still validate.
  - Fixture match per role quest produces the documented slot layout; display rule verified in export JSON.
  - Sample sizes reported per new context dimension.

### B-044 — Items engine rewrite (v3)

- **Milestone:** M3 · **Size:** L → split · **Decision IDs:** D-103, D-093, D-082..D-087, D-095 (PROPOSED — owner OK needed), D-102
- **Split:**
  - **B-044a (M):** Core recommender: like-for-like backoff + analytic fallback (D-093 design direction), win/lose/even scenarios, evidence rule display, labeled rule fallback when data is thin.
  - **B-044b (M):** Backtest/calibration for item contexts (D-023 gate philosophy); build plans; `avoid` list.
- **Dependencies:** B-043, B-042, B-013b, owner approval of PROPOSED item decisions.
- **Out of scope:** sell advice (B-046), fed option (B-045) — separate tickets.
- **Acceptance tests:**
  - Given a `GameState`, output 1–3 items + reasons + sample sizes; thin data → labeled analytic fallback, never invented numbers.
  - Win/lose/even scenarios produce visibly different recommendations on a fixture.
  - Golden tests for at least SUPPORT and TOP item paths.

### B-045 — Fed enemy/ally option

- **Milestone:** M3 · **Size:** S · **Decision IDs:** D-105, D-081 (PROPOSED)
- **Goal:** Player can mark any champion as fed to steer item advice.
- **Content:** Manual "fed" toggle per champion in the game screen; feeds the threat/profile weighting (D-081 threat score — PROPOSED, owner OK needed).
- **Dependencies:** B-044, B-042.
- **Acceptance tests:**
  - Marking a fed enemy changes the recommendation reasons and item order on a fixture; unmarking reverts deterministically.
  - Fed ally supported symmetrically per GOALS.md.

### B-046 — Sell advice

- **Milestone:** M3 · **Size:** M · **Decision IDs:** D-106, D-103
- **Goal:** Advise which owned items to sell for the current situation.
- **Content:** Rule + data hybrid per D-103; respects quest-slot items (never suggest selling quest-line items); shows reason + sample size or "rule" label.
- **Dependencies:** B-044, B-043.
- **Acceptance tests:**
  - Fixture states produce sell suggestions with reasons; quest items never suggested; thin data → labeled rule.
  - Suggestions reference only items the player owns.

### B-047 — Warning borders for missing fields

- **Milestone:** M3 · **Size:** S · **Decision IDs:** GOALS.md "Game screen", D-105
- **Goal:** Only the player's own champion is mandatory; any missing field shows a warning border and can be filled later.
- **Content:** Visual warning treatment on incomplete `PlayerState`/`GameState` fields; manual edit fills them; auto-fill (B-042) clears the warning when data arrives.
- **Dependencies:** B-042b.
- **Acceptance tests:**
  - Each missing field type shows the warning border; filling it (manual or auto) removes it; recommendations still compute with partial data or show an explicit "insufficient input" state — never crash.

---

## Critical path and suggested order

**Critical path:** B-001 → B-002 (spike GO/NO-GO) → B-010a/b (app + data at launch) → B-012/B-015/B-016 (core pick-screen interactions) → B-014 (backtest evidence) → M2/M3 gates.

**First five tickets (suggested order):**

1. **B-001** — decisions D-110..D-113 (unblocks everything; S).
2. **B-002** — Tauri spike (gates the whole app language; needs Windows hardware/CI).
3. **B-003** — Windows CI + better-sqlite3 check (parallel with B-002).
4. **B-004** — public aggregates + size budget (unblocks B-010b and all data display).
5. **B-005** — joint-model deletion + doc fixes (independent; can swap with B-004 if doc hygiene is preferred first).

Then M1 feature work starts at B-010a/B-010b, with B-011 (TOP/JUNGLE exports) and B-019's verification step runnable in parallel at any time.

## Tickets depending on an owner decision

| Ticket            | Blocked on                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| B-002             | Owner confirmation of spike thresholds after measurement (estimates: start < ~3 s, idle mem < ~400 MB)      |
| B-010a/b          | B-002 GO verdict on D-110                                                                                  |
| B-013a/b          | Values are set by backtest (B-013b); mechanism parameters are priors until then                           |
| B-031a/b          | D-106 is accepted, but starter-bundle design direction D-086 is PROPOSED — owner OK required              |
| B-033             | D-089 PROPOSED — explicit owner approval required; BLOCKED until then                                     |
| B-040             | Produces a decision input; B-041/B-042 blocked on its GO verdict + owner sign-off                          |
| B-043/B-044/B-045 | PROPOSED item decisions (D-081..D-086, D-093, D-095) need owner OK at M3 start (D-109)                    |
| B-019             | Verification may conclude "unverified → show internal label"; that fallback needs owner awareness          |
| All               | No ticket implements a PROPOSED decision without owner approval (D-109, golden rule)                        |
