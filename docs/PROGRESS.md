# PROGRESS

Live handoff log for DraftOrb. Newest entries first. Historical session logs live in `docs/PROGRESS_ARCHIVE.md`; task tracking lives in GitHub issues and the Draftorb project board.

## Handoff template

- Date:
- Branch/PR:
- State: TODO | DOING | REVIEW | DONE | BLOCKED
- Done:
- Files touched:
- Tests:
- Blockers / next step:
- Pitfalls:

## Current handoff

- Date: 2026-11-27
- Branch/PR: `main` @ `80cce4a` / BL-009 (#112) — docs-only verification PR `docs/bl-009-m1-verification`
- State: REVIEW (v1a code verification complete; #112 stays OPEN for the owner-side Windows checks)
- Done: final BL-009 verification against current `main`. Every dependency ticket is merged: BL-010a/b, BL-011, BL-012, BL-015, BL-016a/b, BL-017 (PR #164), BL-018..BL-023, BL-050 role enablement (PR #154), BL-024 ADC/MID minimal (PR #161), BL-014 backtest gate (PR #162 — D-133: baseline-only ranking), BL-025 unsigned NSIS installer (PR #165; `release.yml` dispatch run 46019354631 produced artifact `draftorb-windows-x64-setup-main`, ~3.6 MB, no GitHub release yet), BL-052 pick share + denominator (PR #168), BL-053 lint cleanup (PR #170, 0 warnings). `pnpm check` green on `main` including the `windows` job (CI run 46018407901). Code-verified on `main`: SUPPORT pick screen end-to-end (locked allies, role-less enemies with inferred confidence + manual override, bans, "From your pool" above "Best overall" with D-024 invariants, thin-data unavailable cards, personal-record badge, public patch label, theme toggle, portraits); role enablement is data-driven per D-126 (`role-coverage.ts`: >= 50 champions at `n_eff >= minGames` in DIAMOND); ADC/MID minimal via `MINIMAL_ROLES`/`manifest.minimalRoles` (BL-024); matchup layers pinned off with the "Baseline ranking" pill (D-133, B-080 open until `backtest-draft.json` ships in the aggregate archive); BL-022 keyboard-first entry bar present (engine p50 ~2 ms, far under 50 ms). SPECS §2/§7.1 verified; one wording fix (desktop page-size config path).
- Files touched: `docs/PROGRESS.md`, `docs/SPECS.md` (one line).
- Tests: docs-only; CI `pnpm check` green on `main` (run 46018407901, windows job included).
- Blockers / next step: owner-side only — install the NSIS artifact on Windows 11 and run the timed manual draft+bans entry (protocol in PR #159); export `data/pool.config.json` via "Export to repo file"; republish `data-latest` (`pnpm etl publish-public`, manifest v7 + `pick-rate-samples.json`) so the app picks up the newest export. Then close #112.
- Pitfalls: `matchupEnabled` stays pinned `false` in `PickScreen` until the backtest report is part of the aggregate archive (B-080); TOP/JUNGLE/ADC/MID selectability depends on the republished export's baseline coverage (D-126), not on code.

### Previous handoff (BL-052)

- Date: 2026-11-28
- Branch/PR: `feat/bl-052-pick-share-denominator` (worktree `draftorb-bl052`) / BL-052 (#163), merged via PR #168
- State: DONE (merged)
- Done: pick share with its sample denominator on champion cards, all roles (D-131 PROPOSED, owner-approved scope). ETL: new `pick-rate-samples.json` export (`{ [role]: { [championId]: n_eff } }`, `n_eff = games_w^2 / games_w2`) built from the same `exportMinGames`-gated `role_prob` rows as `pick-rate.json` via a shared `gatedRowsByRole` pass, so share and `n` can never diverge; `MANIFEST_SCHEMA_VERSION` 5 -> 7 (BL-013a merged first claiming v6 for `players`; this branch's bump became v7 carrying both features) with frozen `manifestSchemaV5`/`manifestSchemaV6` kept in `PUBLISHED_MANIFEST_SCHEMAS` for the latest-pointer guard and in the desktop cache union. Shared: `pickRateSamplesSchema` (fail-closed, positive finite `n_eff`). Desktop UI only: `PickData.pickRateSamples` sits next to `RecommendData` (never inside it, so it cannot reach `score(c)`); `pick/pick-share.ts` shows the rate only when share + `n_eff >= DEFAULT_CONFIG.minGames` (25), else "not enough data"; legacy exports without the file show no pick-share figure. `RecommendationCard` renders `Pick share P% · n≈N · all ranks` for every role including minimal ADC/MID. `apps/web` untouched except one manifest fixture bump (frozen app, D-121).
- Files touched: `packages/etl/src/export/{pick-rate,index}.ts` + tests, `packages/shared/src/{index,schemas/{champions,core,manifest}}.ts` + tests, `apps/desktop/ui/src/{pick/pick-share.ts(+test),components/{RecommendationCard,RecommendationsList,PickRecommendations}.tsx(+test),data/{export-data.ts(+test),export-data-recovery.test.ts,role-coverage.test.ts},screens/PickScreen.tsx,strings.ts}`, `apps/web/src/data/loader.test.ts` (fixture only), `docs/{DATA_MODEL,SPECS,DECISIONS,PROGRESS}.md`.
- Tests: `pnpm check` green.
- Blockers / next step: owner review; pick share appears only after the next `pnpm etl publish-public` republish (v7 manifest + `pick-rate-samples.json`).
- Pitfalls: decision id is **D-131**, not D-129 — D-129 is taken by in-flight PRs #162/#164 and D-130 by PR #165; renumber on merge if those land first. The samples file is optional for consumers: `loadPickData` treats a missing `pick-rate-samples.json` as "no pick-share figure", but a corrupt one fails closed like every manifest file.

### Previous handoff (BL-024)

- Date: 2026-11-27
- Branch/PR: `feat/bl-024-adc-mid-minimal` (worktree `draftorb-bl-024`) / BL-024 (#89), merged via PR #161
- State: DONE
- Done: ADC/MID are now selectable minimal roles (D-097, D-128 PROPOSED). Engine: `RecommendConfig.minimalRoles` (default `['ADC','MID']`, `MINIMAL_ROLES`) makes `recommend()` skip role inference and all matchup layers (pairs, lane, comp, blind) — score is the shrunk baseline win rate; pool join, roleProb/pickRate candidate selection and `n_eff` gating unchanged. Shared: `manifest.minimalRoles` added, `MANIFEST_SCHEMA_VERSION` 4 -> 5. ETL: export writes `roles/ADC|MID/baseline.json` only; `manifest.roles` lists all five roles; `checkPublishedExport` validates minimal roles from baseline alone. UI: `createRecommendData` takes a `minimal` flag (empty pair/lane tables), `PickData.minimal` shows a "champion-level stats only" note, `roleAvailability` no longer hardcodes ADC/MID — D-126 coverage decides like every role. Backtest `RecommendData` mirrors the baseline-only export for minimal roles. Review fixes: `readPublishedPointer` accepts manifests validating against the current schema or the frozen `manifestSchemaV4` (malformed manifests no longer keep a newer pointer — recovery tests for malformed v5/v4 added); pick-share card display dropped — `pick-rate.json` has no exported sample denominator and SPECS §7 forbids a bare % (D-128); `validate-export` now warns per role when baseline coverage fails the D-126 gate (< 50 champions at `n_eff >= minGames` in DIAMOND), so thin ADC/MID exports are visible before publish.
- Files touched: `packages/engine/src/{config,recommend}.ts` + tests (`recommend-minimal.test.ts` new, golden ADC/MID fixtures re-pinned, layer-mechanics tests opt out via `minimalRoles: []`), `packages/shared/src/schemas/{core,manifest,index}.ts`, `packages/etl/src/export/{index,manifest,sample-check}.ts` + tests, `apps/desktop/ui/src/{roles,strings}.ts`, `data/{export-data,role-coverage}.ts` + tests, `screens/PickScreen.tsx`, `apps/web` + shared/desktop manifest fixtures (schema v5), `docs/{DATA_MODEL,DECISIONS,PROGRESS}.md`.
- Tests: `pnpm check` green (1643 tests, 158 files).
- Blockers / next step: owner review; ADC/MID become selectable only after the next `pnpm etl publish-public` republish (v5 manifest) with sufficient baseline coverage.
- Pitfalls: golden fixtures for ADC/MID now pin minimal (baseline-only) output — do not "fix" them back to full layers; layer-mechanics unit tests must pass `minimalRoles: []` to keep exercising pairs/lanes for ADC/MID. `manifest.minimalRoles` is required (strict schema) — every hand-written manifest fixture needs it.

### Previous handoff (BL-050)

- Date: 2026-11-26
- Branch/PR: `feat/bl-014-backtest-gate` / BL-014 (#78)
- State: REVIEW
- Done: first real `pnpm etl backtest draft --roles=SUPPORT,TOP,JUNGLE` on the private DB (holdout 16.22, 13 946 games) failed the new D-023 paired-bootstrap gate (engine log-loss 0.6972 vs baseline 0.6950, Δ −0.0023, 95% CI excludes 0 on match and player units). Per the owner's Option 3 directive, D-133 puts matchup layers behind a report-driven flag: engine `matchupEnabled`/`matchupShrinkK`, ETL train-only k CV + single holdout eval (`matchup` block in `backtest-draft.json`), web `matchupConfigFromReport` fail-safe + reworded banner, desktop pinned off (B-080). Shrinkage CV picked variant `off` — the app now ranks by champion win rates only.
- Files touched: `packages/engine/src/{config,levels,recommend,recommend-terms}.ts` + `test/recommend-matchup-flag.test.ts`, `packages/etl/src/{backtest/draft.ts,backtest/draft.test.ts,commands/backtest.ts,commands/backtest.test.ts,config/etl-config.ts}`, `apps/web/src/{data/backtest-report.ts,data/backtest-validation.ts,data/backtest-validation.test.ts,components/{DraftScreen,UnvalidatedModelBanner}.tsx,strings.ts}`, `apps/desktop/ui/src/{screens/PickScreen.tsx,strings.ts,components/{Header,AppShell.test}.tsx/ts}`, `docs/{DECISIONS,SPECS,SETUP,BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green. Engine: flag off ⇒ score = baseline prior exactly, empty reasons, no matchup warnings; shrinkage monotonic. ETL: gate/bootstrap, `--roles`, matchup experiment on seeded DBs. Web: `matchupConfigFromReport` fail-safe cases.
- Blockers / next step: PR pending. Gate thresholds in `ETL_CONFIG.backtest` are provisional (`thresholdsPendingOwnerConfirmation` in the report). Desktop needs the report shipped in the aggregate archive before `matchupEnabled` can be report-driven there (B-080). Re-run `pnpm etl backtest draft` after each data refresh (SETUP.md); revisit at ×3/×10 match volume.
- Pitfalls: `data/public/` is gitignored — the report is generated, not committed; the PR body carries the numbers. `matchupEnabled` engine default stays `true` for backward compat; apps must pass the report-derived value. If `runMatchupExperiment` returns null (too few training patches) `validationStatus` falls back to the shadow gate — apps still stay off via `matchup.enabled`.

### Previous handoff (BL-023)

- Date: 2026-11-26
- Branch/PR: `feat/bl-023-pool-collection` / PR #157 / BL-023 (#88)
- State: REVIEW
- Done: pool-driven collection for match ingestion (D-102, D-114). New `pool-config.ts` loads/validates `data/pool.config.json` via the shared `poolConfigSchema` (missing file → `null`, invalid → throws; `DRAFTORB_POOL_CONFIG_PATH` env override mirrors `DRAFTORB_DB_PATH`). New `matches-select.ts` extracts player selection from `ingestMatches`: pending-first ordering unchanged, and when pool pairs exist, players with `participants` rows matching a pool champion×role pair (joined to `matches` for platform) move to the front of their pending/done group; `rank_score` remains the fallback. `ingestMatches` takes `poolConfig` and logs a pool-priority summary. `etl matches` loads the repo pool file (warn + rank-order fallback on invalid), passes it through, and gains `--dry-run`: prints every selected player with `[pool]`/`[rank]` reason, pending/done status and rank_score, with zero Riot calls (read-only DB, refuses pending migrations). SETUP.md updated.
- Files touched: `packages/etl/src/{pool-config.ts,pool-config.test.ts,matches-select.ts,matches-select.test.ts,matches.ts,matches.test.ts,matches.test-helpers.ts,commands/matches.ts,commands/matches.test.ts,db/migrate.ts,db/index.ts,status.ts}`, `docs/{SETUP,PROGRESS}.md`.
- Tests: new `matches-select.test.ts` (5: pool priority, rank fallback/empty pool, pending-vs-done groups, platform scoping, refresh cursor scope), `pool-config.test.ts` (4), `commands/matches.test.ts` (dry-run incl. sidecar cleanup + pre-checksum ledger), one `ingestMatches` end-to-end order test; `pnpm check` green.
- Blockers / next step: PR #157 open, CI green, Devin Review findings addressed. `data/pool.config.json` does not exist yet — the owner commits it via the program's "Export to repo file" (BL-016a/BL-006 hand-off); until then behavior is identical to before.
- Pitfalls: pool priority keys on `(champion_id, role)` pairs — a pool champion seen in another role does not count; `participants` rows come from already-ingested matches, so a never-seen player cannot match (cold-start limitation, inherent to the design). A read-only SQLite connection on a WAL database creates `-shm`/`-wal` sidecars it cannot checkpoint on close; `matches --dry-run` removes only the ones it created.

### Previous handoff (BL-050)

- Date: 2026-11-26
- Branch/PR: `feat/bl-050-role-enablement` / PR #154 / BL-050 (#153)
- State: REVIEW
- Done: role enablement is now data-driven (D-126). New `apps/desktop/ui/src/data/role-coverage.ts`: pure `enabledRolesFromFiles` (distinct champions with a `baseline.json` row at `n_eff >= minGames` in the DIAMOND bucket, >= 50 to enable) plus `loadEnabledRoles` reading only the baseline files through the shared `loadCachedRelease` helper extracted from `export-data.ts`. `App` recomputes on `dataReadyNonce` and feeds `enabledRoles` to `AppShell`/`RoleSelector`; `DEFAULT_ENABLED_ROLES` remains the no-data fallback. `roleNeedsData` string updated ("Not enough champion data for this role"); ADC/MID keep the minimal-roles reason. Review follow-ups (Devin Review + bot commits): active-role fallback to first eligible role, per-role JSON parse in `loadEnabledRoles`, `loadPickData` skips other roles' corrupt files, `loadChampionCatalog` keeps the pool editor's champion picker usable with no eligible role, dropped-champion notice in the fallback editor.
- Files touched: `apps/desktop/ui/src/{App.tsx,config.ts,roles.ts,roles.test.ts,strings.ts,screens/PickScreen.tsx,components/{AppShell,RoleSelector}.tsx,data/{role-coverage.ts,role-coverage.test.ts,export-data.ts,export-data.test.ts,export-data-recovery.test.ts}}`, `docs/PROGRESS.md`.
- Tests: `pnpm check` green (1592 tests); `role-coverage.test.ts` covers the 49/50 boundary, empty/missing baseline, DIAMOND bucket filtering, non-baseline files ignored and the cache loader; verified live in the Tauri app (TOP/JUNGLE selectable on patch 16.22 after `pnpm etl publish-public`).
- Blockers / next step: PR #154 open, CI green, Devin Review findings addressed. Verify TOP/JUNGLE selectable in the Tauri app on Windows.
- Pitfalls: enablement reads `manifest.roles`, not `manifest.files`; a role exported without a baseline file counts as zero coverage. `nEff`/`DEFAULT_CONFIG` come from `@draftorb/engine` (pure, already a UI dependency). The `data-latest` release asset must be republished (`pnpm etl publish-public`) for new roles to reach the app.

### Previous handoff (BL-022)

- Date: 2026-11-26
- Branch/PR: `feat/bl-022-fast-draft-entry` / BL-022 (#87), merged via PR #159
- State: DONE
- Done: keyboard-first draft entry on the pick screen. New pure module `ui/src/pick/draft-entry.ts` (10 pick targets in entry order, digit-key map, next-empty advance, ban list rules) + `ui/src/components/DraftEntryBar.tsx` (persistent champion combobox that stays open after each pick, slot chips, role chips for the active slot, ban pseudo-target) + `ui/src/components/BanList.tsx`. `PickScreen` gained `bans` state wired into `DraftInput.bans`, a shared `blockedChampionIds` set (picked ∪ banned) for slot pickers and the entry search, and auto-advance to the next empty slot after each entry-bar pick. SPECS §10 documents the keyboard contract; `scripts/bench-recommend.ts` (`pnpm --filter @draftorb/desktop bench:recommend`) measures engine latency.
- Files touched: `apps/desktop/ui/src/{pick/draft-entry.ts,pick/draft-entry.test.ts,components/DraftEntryBar.tsx,components/draft-entry-bar.test.ts,components/BanList.tsx,screens/PickScreen.tsx,strings.ts}`, `apps/desktop/scripts/bench-recommend.ts`, `apps/desktop/package.json`, `docs/SPECS.md`, `docs/PROGRESS.md`.
- Tests: `pnpm check` green (1587 tests). Engine latency on the real 16.22 export: SUPPORT p50 1.75 ms / p95 2.44 ms, TOP p50 1.90 ms, JUNGLE p50 2.22 ms (n=300 each, well under the 50 ms budget). Timed mouse-free draft entry still needs the owner's manual run (protocol in the PR).
- Blockers / next step: merged. BL-016b ban-list UI note in PROGRESS is now covered by `BanList`.
- Pitfalls: the entry-bar dropdown stays open after Enter picks (rapid entry); it closes on Escape, outside pointerdown, or Tab away from the search (options keep it open so clicks land). Digit jumps only work with an empty query — champion names contain no digits.

### Previous handoff (BL-003)

- Date: 2026-11-26
- Branch/PR: `feat/bl-003-windows-ci` / PR #155 / BL-003 (#69)
- State: REVIEW
- Done: new `windows` job in `.github/workflows/ci.yml` (`windows-latest`, Node 22, same format-bot gating as `lint`/`test`): `pnpm install --frozen-lockfile`, a named `better-sqlite3 prebuilt check` step, `pnpm check`, and the Tauri spike build `pnpm --filter @draftorb/desktop tauri build --no-bundle` (BL-002 landed, D-115 Rust exception scoped to `apps/desktop`); `windows-latest` was dropped from the `test` matrix to avoid a duplicate Windows suite run. New test `packages/etl/src/db/native-prebuild.test.ts` asserts `binding.js`'s `getPrebuildPath()` resolves a shipped `prebuilds/<platform>-<arch>.node` (no node-gyp fallback) and that an in-memory database opens and round-trips a row. CI on PR #155: every step green (windows job ~6-9 min). ETL-on-Windows end-to-end logged as B-079 (renumbered after a B-077 collision on main).
- Files touched: `.github/workflows/ci.yml`, `packages/etl/src/db/native-prebuild.test.ts`, `docs/{BUGS,PROGRESS}.md`.
- Tests: `pnpm check` green locally (149 files / 1573 tests, macOS arm64) and on `windows-latest` in CI; actionlint clean on `ci.yml`.
- Blockers / next step: PR #155 open, all checks green; owner review/merge, then close #69.
- Pitfalls: `pnpm vitest run <file>` targets a single test from the repo root (vitest is a root devDependency, not an etl one); `getPrebuildPath()` is exported by `better-sqlite3/lib/binding.js` and is the same lookup the loader uses, so the test proves the prebuilt — not a `build/` node-gyp artifact — is what gets required.

### Previous handoff (BL-011)

- Date: 2026-11-26
- Branch/PR: `feat/bl-017-thin-data-fallback` / BL-017 (#82), worktree `../draftorb-bl017`, PR pending
- State: REVIEW
- Done: thin-data fallback (D-103) for champion picks in the desktop app. Every `DraftResult.insufficientData` entry now renders as an unavailable card appended after the ranked "Best overall" entries (same card/pagination pattern as §7.1 pool unavailable cards) via new `pick/insufficient-items.ts` (`buildInsufficientItems`); "Hide my pool" filters pool members there too, and the user's own pick is excluded like in `buildPoolUnavailableItems` (review fix `d6ab6db`: the user slot is not in `DraftInput`, so a locked thin pick would otherwise render as "not recommended"). The baseline win rate is labeled "Broader win rate" (`strings.broaderWinRate`, replaces `poolBaselineWinRate`) and still appears only when weighted evidence exists; zero-evidence champions show "insufficient data" with `Sample 0.0` and no percentage. Engine output unchanged (already emitted `nEff`/`rawGames`/`winRate` per SPECS §7). SPECS §7 thin-data paragraph updated; DECISIONS.md D-129 (PROPOSED) records the Best-overall placement assumption.
- Files touched: `apps/desktop/ui/src/pick/insufficient-items.ts` (new), `components/{PickRecommendations,UnavailableChampionCard}.tsx`, `components/{unavailable-champion-card.test.ts (new),pick-recommendations.test.ts,recommendations-list.test.ts}`, `strings.ts`, `docs/{SPECS,DECISIONS,PROGRESS}.md`.
- Tests: `pnpm check` green (1648 tests); new card tests cover the broader label, sample size, omitted win rate, n=0 and the user-pick exclusion; `PickRecommendations` test covers thin cards after ranked entries.
- Blockers / next step: owner review of D-129; PR title must be `feat(desktop): thin-data fallback for picks (BL-017)` shape per check-pr-title.
- Pitfalls: pool champions below the gate now appear as unavailable cards in BOTH lists (mirrors scored pool champions appearing in both); intentional per D-129.

### Previous handoff (BL-011)

- Date: 2026-11-26
- Branch/PR: `feat/bl-011-top-jungle-export` / PR #152 / BL-011 (#74)
- State: REVIEW
- Done: `EXPORT_ROLES` extended to `['SUPPORT', 'TOP', 'JUNGLE']` (D-097); TOP/JUNGLE get the full `roles/<ROLE>/` layout (their `lane-full.json` stays empty — 1v1 lane groups). New `pnpm etl sample-report [patch]` (`export/sample-report.ts` + `commands/sample-report.ts`) prints per-file row counts and min/median/max `n_eff` for every `roles/<ROLE>/` file in the published manifest, pooled per role. DATA_MODEL.md documents the role enablement rule; DECISIONS.md D-126 (PROPOSED) records the ADC/MID assumption and the pending owner threshold question.
- Files touched: `packages/etl/src/export/{index.ts,sample-report.ts,sample-report.test.ts,manifest.test.ts,atomic.test.ts}`, `packages/etl/src/commands/{sample-report.ts,sample-report.test.ts,export.test.ts,cli.ts}`, `docs/{DATA_MODEL,SETUP,DECISIONS,PROGRESS}.md`.
- Tests: `pnpm vitest run packages/etl` green (582 tests); real `pnpm etl export` on the local DB wrote 294 files incl. `roles/TOP/` + `roles/JUNGLE/`; `pnpm etl validate-export` PASSED (SUPPORT 54, TOP 91, JUNGLE 70 recommendations at Diamond); `pnpm etl sample-report` shows TOP 95 903 rows / median n_eff 19.3, JUNGLE 94 934 / 20.6.
- Blockers / next step: PR #152 open. D-126 direction confirmed by owner (baseline coverage >= 50 champions in DIAMOND bucket, UI-computed at load time); recorded in DECISIONS.md, implementation ticket #153 (BL-050).
- Pitfalls: TOP/JUNGLE `lane-full.json` is `[]` by design; `validate-export` now requires non-empty recommendations for TOP and JUNGLE, so a thin database can fail the pipeline where SUPPORT alone used to pass.

### Previous handoff (BL-016b)

- Date: 2026-11-26
- Branch/PR: `feat/bl-016b-pool-lists` / PR #151 / BL-016b (#81)
- State: REVIEW
- Done: recommendation-lists UI completed per SPECS §7.1 — empty-pool one-line CTA per role ("No <Role> champions in your pool." + "Edit your pool"), UI-only "Hide my pool" toggle (default off, `hidePoolChampions` keeps global ranks/gaps, score(c) untouched), pool cards show both ranks (`In your pool · #n` badge + global `#rank`), unavailable pool cards now show n_eff, raw games and baseline win rate. New `PoolEditor` modal: champion x roles (pick once, tick roles, same champion under several roles) on the program-stored `PoolConfig`, per-role sections with `n/40` counts, remove/clear, JSON backup (schema-validated import, export to read-only textarea), manual repo-file import/export per §19.3 (export refused while the working copy is dirty — dirtiness derived from canonical serialization). `PickRecommendations` component owns all list shaping (pick exclusion, rank-gap closing, pool filtering, editor open state is lifted to the screen for the top "Edit pool" button). `onPoolChanged` refreshes the pool-sync banner after save/repo export (D-118). SPECS unchanged.
- Files touched: `apps/desktop/ui/src/{App.tsx,strings.ts}`, `components/{AppShell,PickRecommendations,PoolEditor,PoolAddForm,PoolRoleSection,PoolTransferSection,RecommendationsList,UnavailableChampionCard}.tsx`, `components/{pick-recommendations,recommendations-list,pool-editor}.test.ts`, `pick/{hide-my-pool.ts,pick.test.ts}`, `pool/{pool-model.ts,pool-model.test.ts}`, `screens/PickScreen.tsx`.
- Tests: `pnpm check` green (1544 tests); new tests cover `hidePoolChampions`, `championPoolRoles`, list rendering (tags/ranks/pagination/unavailable), `PickRecommendations` CTA/both-lists, `PoolEditor` static render.
- Blockers / next step: PR #151 open; Windows check pending. Engine `poolRecommendations` contract verified, not rewritten. Review fixes: editor logic moved to the pure `pool/pool-editor-state.ts` reducer (stale checkboxes, apply-with-no-role removes, export guard, all unit-tested); working copy resets only on open; native `<dialog>` + `showModal()` for focus and inert background (manual keyboard check pending in Tauri). Follow-up (out of scope): the pool editor is unreachable when aggregate loading fails — move it out of the pick screen in a separate issue.
- Pitfalls: `dirty` in the editor is `serializePoolConfig(working) !== serializePoolConfig(pool)` — canonical order makes it exact; the repo-export guard therefore also clears when edits are reverted.

### Previous handoff (BL-015)

- Date: 2026-11-26
- Branch/PR: `feat/bl-009-pick-screen` / PR #148 / BL-015 (#79)
- State: REVIEW

### Previous handoff (BL-018)

- Date: 2026-11-17
- Branch/PR: `feat/bl-018-record-badge` (local only, not pushed, stacked on `feat/bl-016a-pool-ui`) / BL-018 (#83)
- State: REVIEW
- Done: D-119 rule implemented. Rust `read_profile_file` (validated plain `.json` names, reads `<repo>/data/public/profiles/<file>`, missing = `None`). Frontend `loadProfileExport` (index.json, first entry per D-118, validated with the shared schemas, never throws), pure `personalRecord` (champion + role, raw win rate from `RECORD_MIN_GAMES` = 5), `RecordBadge` component (`N games · X%`, `Not enough data (N game(s))`, `No data`, tooltip with label, synced date and export game count). The app loads the export after settings load and when `repoFolder` changes; Settings shows a "Personal record" status line. `syncedAt` is unix SECONDS (`Math.floor(ms / 1000)` in `packages/etl/src/profile-export.ts`), formatted as `YYYY-MM-DD` (UTC).
- Files touched: `apps/desktop/src-tauri/src/{main.rs,repo_pool.rs,profile_file.rs}`, `apps/desktop/ui/src/{App.tsx,config.ts,strings.ts,components/*,profile/*}`, tests, `docs/{SPECS,PROGRESS}.md`.
- Tests: `pnpm check`; `cargo test`; `build:ui`.
- Blockers / next step: the badge is not rendered on any screen yet (no cards): wiring onto recommendation cards comes with BL-016b, including the test that the badge does not alter `recommendations` order. Windows check pending.
- Pitfalls: the profile export covers at most 180 days and `profileMaxGames` games (D-069), so the badge counts only those.

### Previous handoff (BL-016a UI)

- Date: 2026-11-17
- Branch/PR: `feat/bl-016a-pool-ui` (local only, not pushed, stacked on `feat/bl-016a-pool-backend`) / BL-016a (#80), limited UI part
- State: REVIEW
- Done: Settings screen "Repo folder" text field with Save/Clear and help text (SPECS §19.1); the folder is validated by the new Rust command `check_repo_folder` (`<repo>/data` must be a directory) before `repoFolder` is stored, the old value is kept on error, an empty value clears it; plain browser shows "available in the desktop program only". Pure `poolSyncStatus` (noFolder / missingFile / invalid / inSync / differs) computed after settings load and whenever `repoFolder` changes; `PoolSyncBanner` warns only for `differs` and shows a small notice for `invalid` (warning only, no import/export, D-118). The pool load notice is shown when there is no settings notice.
- Files touched: `apps/desktop/src-tauri/src/{main.rs,repo_pool.rs}`, `apps/desktop/ui/src/{App.tsx,settings.ts,strings.ts,components/{AppShell,SettingsScreen,PoolSyncBanner}.tsx,pool/pool-sync.ts}`, tests, `docs/PROGRESS.md`.
- Tests: `pnpm check`; `cargo test`; `build:ui`.
- Blockers / next step: remaining for BL-016a: champion x roles editor and import/export buttons, both waiting for the exported catalog from BL-010b (owner choice); folder picker deferred by owner; drop-unknown notice wiring. SPECS needed no change.
- Pitfalls: `check_repo_folder` only proves `data/` exists, not that it is a DraftOrb clone.

### Previous handoff (BL-016a backend)

- Date: 2026-11-17
- Branch/PR: `feat/bl-016a-pool-backend` (local only, not pushed, stacked on `docs/bl-006-data-handoff`) / BL-016a (#80), backend half
- State: REVIEW
- Done: shared `poolConfigSchema` (SPECS §19.3; `.strict()`, unique ids per role, max 40, optional `name`) with tests and a DATA_MODEL entry. Desktop pure pool model (`ui/src/pool/pool-model.ts`: `setChampionRoles`, `poolDiffers`, `serializePoolConfig`, `parsePoolConfig`, `dropUnknownChampions`) using the same shape as the file, so export is serialization and import is parsing. Rust: `load_settings`/`save_settings` replaced by `load_app_file`/`save_app_file` with an allowlist (`settings.json`, `pool.json`), plus `read_repo_pool`/`write_repo_pool` for `<repoFolder>/data/pool.config.json` (never creates folders, atomic write). Frontend `pool-store.ts`, `repo-pool.ts`; `settingsSchema` gains optional `repoFolder`; `persistThemeChoice` now keeps other settings fields (it would have dropped `repoFolder`).
- Files touched: `packages/shared/src/{index.ts,schemas/pool-config.ts}`, `packages/shared/test/pool-config.test.ts`, `apps/desktop/src-tauri/src/{main.rs,app_files.rs,repo_pool.rs}`, `apps/desktop/ui/src/{settings.ts,App.tsx,strings.ts,pool/*}`, tests, `docs/{DATA_MODEL,PROGRESS}.md`.
- Tests: `pnpm check`; `cargo test` in `apps/desktop/src-tauri` (9 tests); `build:ui`.
- Blockers / next step: remaining for BL-016a: pool editor UI (champion x roles), difference banner UI, folder picker (needs a dialog dependency decision), drop-unknown notice wiring once the catalog arrives with BL-010b, UI tests. SPECS §19 needed no change.
- Pitfalls: `pool.json` (program pool) and `data/pool.config.json` (repo copy) are different files; `load_app_file` returns `""` for a missing file, which `loadPool` maps to a silent empty pool.

### Previous handoff

- Date: 2026-11-17
- Branch/PR: `docs/bl-006-data-handoff` (local only, not pushed, stacked on `feat/bl-019-patch-labels`) / BL-006 (#109)
- State: REVIEW
- Done: SPECS §19 data hand-off contract (repo folder setting, private profile export read-only, public `data/pool.config.json` format/write/read/difference warning, privacy checklist) and a §2.1 pointer; D-118 records the owner's three design choices (one repo-folder setting, first profile of `index.json`, warning-only on pool difference); SETUP.md "Desktop app data folders" section.
- Files touched: `docs/{SPECS,DECISIONS,SETUP,PROGRESS}.md`.
- Tests: docs-only; `pnpm format:check`.
- Blockers / next step: owner signed off SPECS §19 on 2026-11-17 (recorded in D-118); next BL-016a implements the pool storage + repo-file actions and BL-018 the badge loader. The `pool.config.json` zod schema is specified here but not yet written (BL-016a).
- Pitfalls: the program never runs git and never reads the SQLite DB; `profiles/` must never reach a public artifact (`scripts/check-public-paths.mjs`).

### Previous handoff (BL-019)

- Date: 2026-11-17
- Branch/PR: `feat/bl-019-patch-labels` (local only, not pushed, stacked on `feat/bl-021-champion-portraits`) / BL-019 (#84)
- State: REVIEW
- Done: D-117 appended verbatim to `docs/DECISIONS.md`. New pure `patch-labels.ts` (`16.N` -> `26.N`, a one-line table for future verified majors; full versions and anything else give no public name). `DataStatus.loaded` now carries the internal `patch` label (renamed from `patchPublic`); the header shows `Patch 26.22 · data 16.22`, `Patch 17.3 (data label; public name unknown)` or the unchanged `Patch —` / `No data loaded yet`. GOALS open item moved to Resolved; SPECS §12 sentence added.
- Files touched: `apps/desktop/ui/src/{patch-labels.ts,patch-labels.test.ts,data-status.ts,data-status.test.ts,strings.ts,components/Header.tsx}`, `docs/{DECISIONS,GOALS,SPECS,PROGRESS}.md`.
- Tests: `pnpm check`; `pnpm --filter @draftorb/desktop build:ui`.
- Blockers / next step: BL-019 UI is complete; the app still produces only `none` until real data arrives with BL-010b.
- Pitfalls: `patchLabels` accepts only `major.minor`; pass the export patch label, never a full Data Dragon version.

### Previous handoff (BL-021)

- Date: 2026-11-17
- Branch/PR: `feat/bl-021-champion-portraits` (local only, not pushed, stacked on `feat/bl-020-theme-toggle`) / BL-021 (#86)
- State: REVIEW
- Done: `ui/src/data/champion-icons.ts` (copied and adapted from `apps/web`: `resolveIconVersion`, `championIconUrl`, once-per-session `loadDDragonVersions`, `loadChampionIconVersion`, all degrading to null) and `ui/src/components/ChampionPortrait.tsx` (`<img alt>` with a switch to an initials fallback on `onError`, `championInitials`, sm/md/lg, dark-mode classes). `connect-src` in `csp` and `devCsp` now includes `https://ddragon.leagueoflegends.com`. Tests for version resolution, URL encoding, initials and both render paths.
- Files touched: `apps/desktop/ui/src/{data/champion-icons.ts,data/champion-icons.test.ts,components/ChampionPortrait.tsx,components/ChampionPortrait.test.ts}`, `apps/desktop/src-tauri/tauri.conf.json`, `docs/PROGRESS.md`.
- Tests: `pnpm check`; `pnpm --filter @draftorb/desktop build:ui`.
- Blockers / next step: not wired into any screen: no champion catalog exists in the desktop app until BL-010b, and no fake list was added. Recommendation cards, draft slots, pool editor and ban list (BL-016b/BL-022) use the component.
- Pitfalls: offline behavior is the `onError` fallback; icon caching relies on the webview HTTP cache (not verified). The `onError` fallback state sticks for the component instance (a reused instance with a new `iconUrl` would keep the fallback; key the component by URL when wiring lists).

### Previous handoff (BL-020)

- Date: 2026-11-17
- Branch/PR: `feat/bl-020-theme-toggle` (local only, not pushed, stacked on `feat/bl-010a-desktop-scaffold`) / BL-020 (#85)
- State: REVIEW
- Done: the app renders nothing until the stored settings are loaded, so a stored light choice on a dark OS no longer flashes dark (`system` still follows the OS live). `persistThemeChoice` (settings.ts) is the single path for saving a choice. New `theme-persistence.test.ts` (mocked IPC): fresh profile follows a dark/light OS, a stored choice wins over the OS, a saved choice reloads identically (restart). Every component already carries dark-mode classes (header, nav, role selector, settings screen, notice and badge); text inherits the themed body colors.
- Files touched: `apps/desktop/ui/src/{App.tsx,settings.ts,theme-persistence.test.ts}`, `docs/PROGRESS.md`.
- Tests: `pnpm check`; `pnpm --filter @draftorb/desktop build:ui`.
- Contrast (WCAG, rendered-DOM audit on Windows via headless Edge — every text element on Pick + Settings screens in both themes measured with computed styles; all >= 4.5:1, minimum 6.29 white-on-indigo-600, nothing adjusted):

| Theme | Pair                                            | Ratio |
| ----- | ----------------------------------------------- | ----- |
| light | body text slate-900 on slate-50                 | 17.06 |
| light | muted slate-600 on white (header)               | 7.58  |
| light | muted slate-600 on slate-50 (pick placeholder)  | 7.24  |
| light | badge amber-900 on amber-100                    | 8.15  |
| light | notice amber-900 on amber-50                    | 8.75  |
| light | selected white on indigo-600                    | 6.29  |
| dark  | body text slate-100 on slate-900                | 16.30 |
| dark  | muted slate-300 on slate-800 (header)           | 9.85  |
| dark  | muted slate-300 on slate-900 (pick placeholder) | 12.02 |
| dark  | badge amber-200 on amber-900/40 over slate-800  | 10.19 |
| dark  | notice amber-100 on amber-900/30 over slate-900 | 13.96 |
| dark  | selected white on indigo-600                    | 6.29  |

- Blockers / next step: verify on Windows 11 (real OS theme switch, first paint). Disabled controls use opacity-50 (exempt from contrast).
- Pitfalls: the window background is native until the page paints; a brief blank frame is expected.

### Previous handoff (BL-010a)

- Date: 2026-11-17
- Branch/PR: `feat/bl-010a-desktop-scaffold` (local only, not pushed) / BL-010a (#72), skeleton part
- State: REVIEW
- Done: `apps/desktop` is now the app skeleton: React 19 + Tailwind 3 frontend (`ui/src`), header with patch/data status placeholder, "Unvalidated model" label and theme toggle, navigation (Pick enabled, Setup/Game disabled, Settings), SUPPORT-only role selector driven by `roleAvailability`, D-107 theme plumbing, zod-validated settings stored by the program (`load_settings`/`save_settings` Rust commands, atomic write in the app config dir). Restrictive CSP in `tauri.conf.json`. `report_metrics`/`process_uptime_ms` kept for `scripts/bench.ts`. `@tauri-apps/api` recorded in D-116.
- Files touched: `apps/desktop/**`, `vitest.config.ts`, `pnpm-lock.yaml`, `docs/{SETUP,ARCHITECTURE,DECISIONS,PROGRESS}.md`.
- Tests: `pnpm check`; `cargo test` in `apps/desktop/src-tauri`.
- Blockers / next step: remaining for BL-010a: Windows 11 launch and threshold re-measure with the real app, data status and download/cache/stale notice (BL-010b, needs the BL-004 host and a `connect-src` CSP entry), BL-014 pick-screen behavior, Windows CI job (BL-003).
- Pitfalls: `gen:icon` now also writes `icons/icon.png` (non-Windows builds need it). The bench script is Windows-only (taskkill, PowerShell).

### Previous handoff

- Date: 2026-11-17
- Branch/PR: `chore/bl-008-ci-safety` (local only, not pushed) / BL-008 (#111)
- State: REVIEW
- Done: `scripts/check-secrets.mjs` gains a `PUUID-like identifier` needle (78 base64url chars with a letter and a digit, `+/=` excluded at the boundaries); the synthetic PUUID in `packages/etl/src/riot/client.test.ts` is split by concatenation. New `scripts/check-public-paths.mjs` (`profiles/` directories and SQLite files; git ls-files or `--dir`) and `scripts/check-pr-title.mjs` (`BL-<n>[a-z]` from `PR_TITLE`). New CI job `safety` (pull_request only, not Dependabot). Documented in WORKFLOW.md and TESTING.md.
- Files touched: `scripts/check-{secrets,public-paths,pr-title}.{mjs,test.ts}`, `packages/etl/src/riot/client.test.ts`, `.github/workflows/ci.yml`, `docs/{WORKFLOW,TESTING,PROGRESS}.md`.
- Tests: `pnpm check`; each script has fixture-violation tests.
- Blockers / next step: the `safety` job can only be proven green once pushed. BL-004 must run `check-public-paths.mjs --dir` on the public aggregates tree. Bug-fix PRs titled only with `B-xxx` fail the title check by design of the ticket criterion; raise with the owner.
- Pitfalls: do not wire `--dir` into `etl.yml`: the state tarball (private) intentionally contains `profiles/`.

### Previous handoff (BL-012)

- Date: 2026-11-17
- Branch/PR: `feat/bl-012-bans-engine` (local only, not pushed) / BL-012 (#75), schema + engine part
- State: REVIEW
- Done: `draftInputSchema.bans` (max 10, unique, banned-and-picked rejected with the champion id), `poolUnavailable` reason `banned`, `DRAFT_RESULT_SCHEMA_VERSION` 1 -> 2. Engine: `buildCandidateSet` excludes banned champions (picked wins over banned) and exposes `banned`; pool entries report `banned`; the unseen blind opponents exclude picked and banned champions. No scoring math or config change. SPECS §2/§4/§5/§7/§7.1 updated.
- Files touched: `packages/shared/src/schemas/{core,draft}.ts`, `packages/shared/test/{index,parity}.test.ts`, `packages/engine/src/{recommend,recommend-pool,recommend-test-utils}.ts`, `packages/engine/test/recommend-bans.test.ts`, `docs/{SPECS,PROGRESS}.md`.
- Tests: `pnpm check`; new `recommend-bans.test.ts` written red first.
- Blockers / next step: the UI part of BL-012 (manual bans input, UI test) remains for after BL-010a; legacy `apps/web` has no bans UI.
- Pitfalls: any consumer pinning `DraftResult.schemaVersion` to 1 must move to 2.

### Previous handoff (BL-005)

- Date: 2026-11-17
- Branch/PR: `chore/bl-005-delete-joint-model` (local only, not pushed) / BL-005 (#71)
- State: REVIEW
- Done: deleted the joint draft model per D-112 (gates D-092/D-092a failed, no consumer): `packages/engine/src/joint/` and its index re-export, `packages/etl/src/joint-fit.ts`, `commands/fit-model.ts` and its CLI registration, `packages/engine/test/joint.test.ts`. Fixed stale docs: ARCHITECTURE.md (status, `latest.json`, Electron -> Tauri D-115), DATA_MODEL.md (aggregates for all roles), GLOSSARY.md (`exportMinGames` default 10), PLAN_SUMMARY.md (shell language resolved by D-115), CONVENTIONS.md (theme D-107, storage D-101/D-114), proposed-etl-schedule.md (D-094 note).
- Files touched: `packages/engine/src/{index.ts,joint/}`, `packages/engine/test/joint.test.ts`, `packages/etl/src/{cli.ts,joint-fit.ts,commands/fit-model.ts}`, `docs/{ARCHITECTURE,DATA_MODEL,GLOSSARY,PLAN_SUMMARY,CONVENTIONS,proposed-etl-schedule,PROGRESS}.md`.
- Tests: `pnpm check`.
- Blockers / next step: owner review; branch is local only.
- Pitfalls: historical mentions of joint/`fit-model` remain on purpose in DECISIONS.md, AUDIT.md, PROGRESS_ARCHIVE.md, TICKETS.md, PROMPTS.md and docs/reports/.

### Previous handoff (BL-002)

- Date: 2026-11-16
- Branch/PR: `feat/bl-002-tauri-spike` / BL-002 PR (this PR)
- State: REVIEW
- Done: BL-002 Windows Tauri spike — new `apps/desktop/` (Tauri v2 shell + Vite/TS frontend running a real `recommend()` on the `full_draft_support` golden fixture), `scripts/bench.ts` benchmark, `scripts/gen-icon.ts` icon generator, report `docs/reports/bl-002-tauri-spike.md` (median cold start 362 ms external / 330 ms Rust-side after paint, engine call 0.089 ms avg, idle memory 349 MB — all inside the AUDIT §6 estimates; GO recommendation for D-115, owner confirmation lines left blank), dependency decision D-116, project board BL-001 moved to Done.
- Files touched: `apps/desktop/**`, `docs/{DECISIONS,PROGRESS,reports/bl-002-tauri-spike}.md`, `eslint.config.mjs`, `tsconfig.json`, `.gitignore`, `pnpm-lock.yaml`; project board.
- Tests: `pnpm check` green (1237 tests); benchmark numbers in the report.
- Blockers / next step: owner reviews the PR and fills the confirmation lines in the spike report (thresholds + GO/NO-GO for D-115); then BL-003 (#69) Windows CI job and BL-004 (#70) public aggregates.
- Pitfalls: plain `cargo build` produces a DEV-mode Tauri app (loads `devUrl`, ERR_CONNECTION_REFUSED without a dev server) — production binary needs `pnpm --filter @draftorb/desktop tauri build`; `tauri-build` requires `src-tauri/icons/icon.ico` on Windows even with `bundle.active: false`; Rust `target/` and `src-tauri/gen/` are gitignored; scripts are `.ts` run via `tsx` (not `.mjs`) to stay inside the TS project service.

## Session log (newest first)

### 2026-11-16 — Devin — BL-002 Windows 11 Tauri spike + benchmark report

- Done:
  - Scaffolded `apps/desktop/`: `src-tauri/` minimal Tauri v2 app (two commands: `process_uptime_ms`, `report_metrics`), `ui/` Vite + vanilla TS frontend importing `@draftorb/engine` + `@draftorb/shared`, zod-validating `ui/src/fixture.json` (input+data of golden `full_draft_support`) and rendering top-10 `recommend()` output; `scripts/bench.ts` (5-run cold-start/engine-latency/idle-memory benchmark) and `scripts/gen-icon.ts` (PNG-in-ICO generator, tauri-build requirement).
  - Installed Rust toolchain (rustup 1.100.0, MSVC via VS 2022 Community already present); release exe ~9 MB, frontend bundle 128 kB JS / 37.6 kB gzip.
  - Measurements (median of 5): external cold start 362 ms, Rust-reported start→interactive 330 ms (paint-aware via double rAF), `recommend()` avg 0.089 ms (200 iters), idle memory 349 MB across 7 processes (draftorb.exe + WebView2 children).
  - Wrote `docs/reports/bl-002-tauri-spike.md` with methodology, proposed thresholds (cold start <1.5 s, recommend <5 ms, memory <450 MB on real data), GO recommendation for D-115, and blank owner-confirmation lines; added D-116 (Tauri/vite deps) to DECISIONS.md.
  - Fixed lint/typecheck integration: desktop scripts are `.ts` via `tsx`, `**/target/**` eslint-ignored, `apps/desktop` added to root tsconfig references.
- Files touched: `apps/desktop/**`, `docs/{DECISIONS,PROGRESS,reports/bl-002-tauri-spike}.md`, `eslint.config.mjs`, `tsconfig.json`, `.gitignore`, `pnpm-lock.yaml`; GitHub project board (BL-001 → Done).
- Tests: `pnpm check` green — typecheck, lint (0 errors), prettier, 1237 vitest tests.
- State left: REVIEW — awaiting owner review of the PR and the spike report confirmation lines.
- Next step: owner confirms thresholds/GO-NO-GO in the report; then BL-003 (#69) Windows CI job, BL-004 (#70) public aggregates release.
- Pitfalls / notes for next AI: `cargo build` alone = dev-mode app (ERR_CONNECTION_REFUSED); use `pnpm tauri build`. Re-run `bench.ts` with real `data/public/` exports once available — fixture is only 6 kB.

## Session log (newest first)

### 2026-11-15 — Devin — BL-001 decisions D-111..D-115 and AGENTS.md language/shell update

- Done:
  - Appended D-111 (shared aggregates public), D-112 (delete joint draft model code), D-113 (keep raw data and ETL timeline extraction), D-114 (public versioned champion pool file `data/pool.config.json`) and D-115 (TypeScript engine + Tauri shell) to `docs/DECISIONS.md`, each ACCEPTED (owner, 2026-11-15) with an Amends line where the decision map specified one; added the status-header notes ("amended by" / "code deleted by D-112") on D-001, D-079, D-092, D-092a, D-098, D-099, D-101 and D-109 without touching any decision body.
  - AGENTS.md: golden rule 2 now states the Windows desktop program is a Tauri shell around the TypeScript engine (D-115) pending the spike; golden rule 4 keeps every ETL/engine requirement and adds the Rust-toolchain exception scoped to the desktop shell only; repo layout `apps/desktop` line updated from Electron to Tauri.
  - GOALS.md platform line and open items updated (language D-115 pending spike, aggregates location D-111, pool versioning D-114 resolved; Riot policy and patch display still open); REVIEW_CHECKLIST.md Windows bullet now states the final D-115 rule.
  - Issues #67, #68, #69 renumbered after the owner confirmation comment on #67: language/shell decision D-110 -> D-115, range D-110..D-114 -> D-111..D-115; the AGENTS.md rule-4 amendment text moved from the D-110 bullet to the D-115 bullet in #67.
- Files touched: `docs/{DECISIONS,GOALS,REVIEW_CHECKLIST,PROGRESS}.md`, `AGENTS.md`; GitHub issues #67, #68, #69.
- Tests: docs-only change; `pnpm check` run before merge.
- State left: REVIEW — awaiting owner review.
- Next step: owner merges the PR; then BL-002 (#68) Windows Tauri spike and the aggregates-publishing ticket (D-111 host).
- Pitfalls / notes for next AI: D-110 is the ETL snapshot-integrity decision (PR #116, B-070); the language decision is D-115 — older entries saying "BL-001 writes D-110..D-114" are outdated, the real range is D-111..D-115. D-114 records the owner quote "Yes, we can version the pool" (translated from French); D-115 records "Performance only, but I can still change it later." (translated from French)

### 2026-11-15 — Devin — Backlog ticket prefix `B-` → `BL-`

- Done: renamed the backlog ticket prefix from `B-xxx` to `BL-xxx` to disambiguate from bug IDs (`B-xxx` in `docs/BUGS.md`). Retitled all 48 backlog issues (#67–#114) and rewrote their bodies (`Ticket ID:`, `#nn (B-xxx)` refs, `B-xxx`/`B-id` generics); verified no bug references were touched (issue #8 keeps its bug refs). Updated `.github/ISSUE_TEMPLATE/ticket.yml`, `.github/pull_request_template.md`, `docs/PROGRESS.md`, `docs/REVIEW_CHECKLIST.md`; added the `B-`/`BL-` namespace note to `docs/BUGS.md`. Historical docs (`TICKETS.md`, `PROGRESS_ARCHIVE.md`, bug entries) keep `B-xxx` = bugs.
- Files touched: `.github/ISSUE_TEMPLATE/ticket.yml`, `.github/pull_request_template.md`, `docs/{BUGS,PROGRESS,REVIEW_CHECKLIST}.md`; GitHub issues #67–#114.
- Tests: docs-only; `pnpm check` before merge.
- State left: REVIEW.
- Pitfalls / notes for next AI: backlog ticket IDs are `BL-xxx` (GitHub issues), bug IDs are `B-xxx` (`docs/BUGS.md`). New tickets must use `BL-` in the title and `Ticket ID:` field.

### 2026-11-15 — Devin — GitHub issue/project tracking alignment

- Done:
  - Restored `docs/TICKETS.md`, `docs/PROMPTS.md`, `docs/PROGRESS.md` and `docs/PROGRESS_ARCHIVE.md` (deleted by the PR #66 merge) with OBSOLETE banners on TICKETS/PROMPTS pointing to GitHub issues; `docs/BACKLOG.md` stays deleted.
  - Added the "Tickets" section to `AGENTS.md` (read the issue first; acceptance criteria are the contract; decisions go to DECISIONS.md as PROPOSED).
  - Added `.github/ISSUE_TEMPLATE/ticket.yml`, updated `.github/pull_request_template.md` (`Closes #___`, ticked acceptance criteria with evidence) and `docs/REVIEW_CHECKLIST.md` (exact PROPOSED list, Closes #n, D-023 backtest citations, Riot-policy GO gate, reviewer file list).
  - GitHub side: created missing plan issues, set project fields (Status, Milestone, Size, Owner decision needed), edited BL-005/BL-014/BL-023/BL-018/BL-013a/BL-043a/BL-044a/BL-044b/BL-043b per owner instructions; conformity and migration-loss reports are in the PR description.
- Files touched: `AGENTS.md`, `.github/ISSUE_TEMPLATE/ticket.yml`, `.github/pull_request_template.md`, `docs/{REVIEW_CHECKLIST,PROGRESS,TICKETS,PROMPTS,PROGRESS_ARCHIVE}.md`.
- Tests: docs-only change; `pnpm check` run before merge.
- State left: REVIEW — awaiting owner review.
- Next step: owner merges the PR, then BL-001 (#67) writes D-110..D-114.
- Pitfalls / notes for next AI: GitHub issues are the ticket tracker; `docs/BACKLOG.md` is gone — issue bodies that still reference it are listed as non-conforming in the PR description. Do not implement D-110..D-114 before BL-001 records them.

### 2026-11-15 — Devin — BL-000 backlog and review process

- Done:
  - Added `docs/BACKLOG.md` as the authoritative rework backlog with BL-000 marked DONE and explicit `Status` fields for every ticket/sub-ticket.
  - Moved the owner-approved D-114 pool-versioning text into BL-001 so BL-001 writes D-110..D-114 without a numbering gap; removed the premature D-114 entry from `docs/DECISIONS.md`.
  - Reverted the premature AGENTS.md rule-4/Rust amendment; BL-001 now owns that edit when D-110 is written.
  - Updated live docs (`AGENTS.md`, `README.md`, `docs/WORKFLOW.md`, `docs/SETUP.md`, `docs/REVIEW_CHECKLIST.md`, `docs/AUDIT.md`) to point to `docs/BACKLOG.md`; marked `docs/TICKETS.md` and `docs/PROMPTS.md` OBSOLETE with deletion deferred.
  - Archived the previous PROGRESS.md content into `docs/PROGRESS_ARCHIVE.md` and restarted this file as the live handoff log.
  - Tightened BL-005's deletion grep and BL-014's D-023 validation-gate acceptance criteria.
- Files touched: `AGENTS.md`, `README.md`, `docs/{AUDIT,BACKLOG,DECISIONS,PROGRESS,PROGRESS_ARCHIVE,PROMPTS,REVIEW_CHECKLIST,SETUP,TICKETS,WORKFLOW}.md`.
- Tests: docs-only change; `pnpm check` green (111 files / 1237 tests; lint 0 errors, 120 pre-existing warnings; Prettier clean).
- State left: REVIEW — awaiting owner review of PR #66.
- Next step: owner merges PR #66, then BL-001 writes D-110..D-114.
- Pitfalls / notes for next AI: `docs/BACKLOG.md` is authoritative for ticket status; GitHub issues are snapshots and any project board is a view only. Do not implement D-110..D-114 before BL-001 records them.
