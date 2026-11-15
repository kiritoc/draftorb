# AUDIT — pre-rework code audit (D-098)

Date: 2026-11-15. Scope: read-only audit of the monorepo against `docs/GOALS.md` and the approved decisions D-096..D-109. PROPOSED decisions (D-081..D-095, D-088..D-092a per D-109) were audited as code, not treated as requirements. Nothing in the repo was modified.

> **Corrections (follow-up pass, same date):**
>
> - **§5i rewritten.** Champion ids are now resolved by name from `data/public/16.22/champions.json`: Shen=**98**, Nami=**267**, Maokai=**57**, Teemo=**17**. The first pass used wrong ids for Shen/Nami/Maokai (50=Swain, 145=Kai'Sa, 78=Poppy); every affected row was recomputed.
> - **§5h extended** with a measured `gzip -1` size and a `dbstat` per-table breakdown.
> - **§5j and §5k added**: Windows readiness checks (CI runner, `better-sqlite3` prebuilds) and the real backtest evidence found in `docs/reports/`.

## 1. Baseline results

Environment: macOS (Darwin 27), Node v26.12.1, pnpm 12.15.0. The repo declares `engines.node >= 22` and CI runs Node 22; commands were run on Node 26 locally.

| Command             | Result                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm install`      | PASS — "Already up to date", 5 workspace projects                                                            |
| `pnpm typecheck`    | PASS — `tsc --build && tsc -p packages/engine/test && tsc -p packages/shared/test`, 0 errors                 |
| `pnpm lint`         | PASS — 0 errors, 120 warnings (all `@typescript-eslint/no-non-null-assertion` warnings, mostly in ETL tests) |
| `pnpm format:check` | PASS — "All matched files use Prettier code style!"                                                          |
| `pnpm test`         | PASS — 111 test files, 1237 tests, 0 failures (vitest run, ~9 s)                                             |

`pnpm check` was not run as a single command; its four components were run individually with the results above. No command required the Riot API; no `.env` was read.

## 2. Inventory by interface

### 2.1 SQLite (`data/DraftOrb.sqlite`, gitignored)

- File exists locally: **5,671,165,952 bytes (~5.28 GiB)**, last written 2026-11-13. Opened read-only (`sqlite3 -readonly ... immutable=1`; plain `mode=ro` failed with SQLITE_CANTOPEN, `immutable=1` worked).
- Migrations: `packages/etl/migrations/001..020` (20 files). Tables present (verified via `sqlite_master`): `_migrations`, `players`, `matches`, `participants`, `item_events`, `kill_events`, `match_participant_ids`, `lane_snapshots`, `participant_challenges`, `extractor_runs`, `participant_starters`, `item_state_scale`, `ingest_state`, `match_rejects`, `patches`, `entity_change_scores`, `data_breakpoints`, `profiles`, `profile_games`, `profile_mastery`, plus aggregate tables `role_prob`, `baseline`, `pair_ally`, `pair_enemy`, `lane_vs`, `lane_full`, `rune_ctx`, `item_build`.
- Row counts (read-only queries): matches 24,325; participants 243,250 (48,650 per role); players 19,340; match_rejects 559; patches 319 rows (labels 0.151 … 16.22); matches stored only for patches 16.10–16.22 (16.10:2, 16.11:1, 16.13:1, 16.14:12, 16.15:8, 16.16:5, 16.17:6, 16.18:27, 16.19:156, 16.20:1,637, 16.21:8,524, 16.22:13,946); item_events 11,158,808; kill_events 1,422,685; lane_snapshots 1,110,510; participant_challenges 40,030; participant_starters 242,933; item_state_scale 91; profile_games 278; profiles 1; entity_change_scores **0**; data_breakpoints **0**.
- The database is ~11x larger than the ~475 MiB figure in D-091/PROGRESS (timeline/challenge/lane-snapshot backfills landed after that estimate; unverified whether VACUUM was run since).

### 2.2 Exported JSON (`data/public/`, gitignored, produced by `pnpm etl export`)

- `latest.json` (126 B): `{ schemaVersion: 1, patch: "16.22", manifest: "16.22/manifest.json", generatedAt: "2026-11-13T15:16:42Z" }`.
- `16.22/` patch dir: `manifest.json` (schemaVersion **4**, `roles: ["SUPPORT"]` only, 8 rank buckets, 112 hashed files), `champions.json` + `champions.bootstrap.json` + `champions.derived.json` (~21 KB each), `items.json` (291 KB), `runes.json` (25 KB), `role-prob.json` (9 KB), `pick-rate.json` (7 KB), `item-classes.json` (24 KB), `state-scale.json` (801 B), `patch-meta.json` (`patchIndex 319 = currentPatchIndex`).
- `roles/SUPPORT/`: `baseline.json` (34 KB), `ally-pairs.json` (1.7 MB), `enemy-pairs.json` (2.1 MB), `lane-vs.json` (161 KB), `lane-full.json` (11 KB), `runes/<championId>.json` ×52, `builds/<championId>.json` ×43, `build-paths/<championId>.json` ×4.
- **No `roles/TOP`, `roles/JUNGLE`, `roles/MID`, `roles/ADC` directories exist** — only SUPPORT is exported, although aggregates for all five roles exist in SQLite (§5c).
- Root extras: `backtest-draft.json` (702 B, empty report: `holdoutGames: 0`, all metrics null, `perRole` TOP/JUNGLE/MID stubs), `joint-model.json` (2.26 MB, joint-model coefficients, `validationStatus` unvalidated per D-092), `profiles/index.json` + `profiles/kiritoctoc-euw1.json` (profile export currently has `gameCount: 0`, `games: []`, `mastery: 138` entries — stale relative to the 278 `profile_games` rows in the DB).

### 2.3 CLI commands (`pnpm etl <cmd>`, `packages/etl/src/cli.ts`)

`static`, `backtest`, `tune-priors`, `validate-tags`, `check-tags`, `check-key`, `players`, `matches`, `timeline`, `backfill` (timelines), `backfill-challenges`, `fit-model`, `classify-items`, `prune`, `migrate`, `aggregate`, `export`, `validate-export`, `derive-roles`, `status`, `rekey`, `profile-sync`, `pull`, `publish`, `breakpoint`. Note: **no `changes` command exists** — T-019.d (CommunityDragon change scores) is still TODO; `entity_change_scores` has 0 rows.

### 2.4 `packages/shared`

Purpose: single source of truth — types + zod schemas, zero logic. ~178 exported schema/type symbols across `schemas/{core,reasons,draft,codes,recommend-data,personalized,game,champions,tags,manifest,tables,items,runes,profiles}.ts`. Callers: engine, etl, web (all import it). Tests: `packages/shared/test/{index,parity,codes,profiles,recommend-data}.test.ts`. Verdict: **keep** — it is the contract everything else validates against; cost of keeping unused v2 schemas is near zero.

### 2.5 `packages/engine` (pure; verified no Node/DOM imports — enforced by tsconfig `"types": []` + ESLint)

| Module                                                                                                   | Purpose                                                                                                                 | Callers                                                                                                                    | Tests (rough coverage)                                                                                                           | Verdict                | Reason                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommend*.ts`, `roles*.ts`, `weighting.ts`, `levels.ts`, `comp.ts`, `influence-config.ts`, `config.ts` | Draft scoring, role inference, rank kernel, levels, comp needs                                                          | web `DraftScreen` (`recommend`), etl aggregation/backtest/derive-roles                                                     | `recommend-*.test.ts` (~15 files), `roles.test.ts`, `weighting.test.ts` (40), `golden.test.ts`, `comp.test.ts`, `levels.test.ts` | **keep**               | Core of the v1 pick screen; role-generic already. Gaps vs GOALS: bans not modeled, pool is per-role-id list not champion×roles, no distinct-player cap (D-102).     |
| `runes.ts`, `runes-context.ts` (in shared `rune-context.ts`)                                             | Rune page recommender (SPECS §8.1, D-059)                                                                               | web `RunesPanel`/`recommendRunes`; etl `aggregate-runes`                                                                   | `runes.test.ts`                                                                                                                  | **keep (v2)**          | Needed for v2; only SUPPORT rune data exported today.                                                                                                               |
| `personalize.ts`, `profile-setup.ts`                                                                     | Profile-labeled list + "profile's best" runes/spells (D-072..D-080, D-089)                                              | web `PersonalizedList`, `personalized.ts`                                                                                  | `personalize.test.ts`, `profile-setup.test.ts`                                                                                   | **keep (v2), revisit** | Hardcoded `role !== 'SUPPORT'` filters (personalize.ts:183,270; profile-setup.ts:120,152) conflict with D-097's widened profile scope; D-089 blendMode is PROPOSED. |
| `threat.ts`, `item-context.ts`, `items/*`                                                                | Threat score, item context derivation, item recommender + analytic fallback (D-081..D-087, D-093, D-095 — all PROPOSED) | etl `aggregate-items`/`export/builds` (context helpers); **no runtime consumer of `recommendItems`/`computeThreatScores`** | `threat.test.ts`, `item-context.test.ts` (21), `items.test.ts`                                                                   | **rewrite for v3**     | Item-slot model predates the 2026 role quests (D-106); nothing in the app calls it yet.                                                                             |
| `joint/*`                                                                                                | Joint regularized draft model (D-092/D-092a — PROPOSED)                                                                 | etl `fit-model` only; export `joint-model.json` "for inspection"                                                           | `joint.test.ts` (5, incl. planted-effect)                                                                                        | **delete candidate**   | Both validation gates failed (D-092/D-092a); no consumer. See §4.                                                                                                   |

### 2.6 `packages/etl`

Purpose: Riot client + rate limiter, SQLite + 20 migrations, ingestion (`players`, `matches`, `timeline`, `backfill*`, `rekey`, `profile-sync`), aggregation (`aggregate*`), exports (`export/*`), ops (`status`, `prune`, `breakpoint`, `publish`, `pull`, `check-key`, `static`, `derive-roles`, `classify-items`, `validate-*`, `backtest`, `tune-priors`, `fit-model`). ~150 source files, ~70 test files. Verdict: **keep** (D-098 explicitly keeps the pipeline). Per D-102 a pool-driven collection steering option does not exist yet (§5d).

### 2.7 `apps/web`

Vite + React 19 + Tailwind static app. Features (from `App.tsx`/`DraftScreen.tsx`): draft screen with 10 slots, champion search grid, blind-pick toggle, rank selector, SUPPORT-only (`USER_ROLE = 'SUPPORT'` hardcoded, DraftScreen.tsx:65), pool editor (localStorage `draftorb.pool.v1`), "Best overall" + "From your pool" + personalized list + `RunesPanel`, unvalidated-model banner, legal footer, light theme only (no dark toggle found). Data: fetches `latest.json` → manifest → per-file JSON; champion avatars from Data Dragon CDN (D-053). Verdict: **rewrite** — it is a browser app; D-099/D-101 require a Windows program with program-stored per-role×champion pools, TOP/JUNGLE roles, bans input, enemy-role override UI, and theme toggle. The data-loading layer (`data/loader.ts`, `recommend-data.ts`, `runes.ts`) is the most reusable part.

## 3. Module verdict table (summary)

| Module                                 | Verdict           | One-line reason                                                                |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `packages/shared`                      | keep              | Contract layer; cheap to keep whole.                                           |
| `packages/engine` draft core           | keep              | Implements the v1 pick screen; needs bans + D-102 cap + role-scope work.       |
| `packages/engine` runes                | keep (v2)         | SPECS §8.1 implemented and tested.                                             |
| `packages/engine` personalize/profile  | keep (v2), rework | SUPPORT-only filters vs D-097; D-089 pending.                                  |
| `packages/engine` threat/items         | rewrite (v3)      | PROPOSED decisions only; predates D-106 role quests.                           |
| `packages/engine` joint                | delete            | Failed both gates (D-092a); zero consumers.                                    |
| `packages/etl` (all but joint-fit)     | keep              | D-098 keeps the pipeline; scheduled cron live (D-094).                         |
| `packages/etl` `fit-model`/`joint-fit` | delete            | Same as joint model.                                                           |
| `packages/etl` `breakpoint` + tables   | keep (optional)   | Manual breakpoints accepted (D-047); auto `changes` command never implemented. |
| `apps/web`                             | rewrite           | Wrong shell (browser vs Windows program), SUPPORT-only, localStorage pool.     |
| `data/DraftOrb.sqlite` + migrations    | keep              | D-098 keeps the database; schema already role-generic.                         |
| `data/public` export format            | keep              | Role-keyed JSON works; needs TOP/JUNGLE exports added (§5c).                   |

## 4. Cut candidates

### 4.1 Change-score pipeline and breakpoints (D-046, D-047)

- What exists: tables `entity_change_scores` + `data_breakpoints` (migration `016_breakpoints_change_scores.sql`), `breakpoints.ts` + `commands/breakpoint.ts` CLI (`list|add|validate|reject`), `ETL_CONFIG.changeWeightEnabled=false`/`minWeight` (`config/etl-config.ts:20-25`). The `changes` command (CommunityDragon scoring, T-019.d) **does not exist** — `cli.ts` has no `changes` entry.
- What reads them at runtime: **nothing**. `grep changeWeight|breakpoint` over `packages/engine/src` returns no hits; no aggregate module reads the tables; `entity_change_scores` and `data_breakpoints` both have **0 rows** in the live DB.
- Effect on exported numbers: none — change weighting is disabled by design (D-045) and was never enabled.
- Deleting would break: the `breakpoint` CLI command, migration 016 (already applied — dropping tables needs a new migration), SPECS §15/§16 and D-046/D-047 docs. Zero runtime or export impact.

### 4.2 Joint draft model (D-092, D-092a)

- What exists: `packages/engine/src/joint/{features,fit,index}.ts`, `packages/etl/src/joint-fit.ts`, `commands/fit-model.ts`, export `data/public/joint-model.json` (2.26 MB).
- What reads it at runtime: **nothing** — no engine recommend path, no web component, no aggregate imports it. D-092 states the export is "written for inspection but no UI or recommendation path consumes it".
- Effect on exported numbers: none (it writes its own side file).
- Validation status: failed both gates — pick prediction worse than the pick-frequency prior (top1 0.0427 vs 0.0650) and win-probability log-loss not better than side-only (CI includes 0), per D-092/D-092a.
- Deleting would break: `fit-model` CLI, `joint.test.ts`, `joint-model.json`. No product surface.

### 4.3 Personalization code (D-072..D-077, D-080, D-089)

- What exists: engine `personalize.ts` + `profile-setup.ts`; web `PersonalizedList.tsx`, `personalized.ts`, `data/profile.ts`, `pool/favorites.ts`; ETL `profile-sync.ts`, `profile-export.ts`, `profiles-config.ts`, tables `profiles`/`profile_games`/`profile_mastery` (278 games stored for the single configured profile).
- What reads it at runtime: the web app does (profile-labeled list, favorites import, "profile's best" runes/spells columns). It is a **v2** feature per D-100 — currently shipped in the web app ahead of the version plan.
- Effect on exported numbers: none on aggregate stats; it produces `data/public/profiles/*.json` (anonymized per D-069).
- Caveats: SUPPORT-only filters conflict with D-097's widened scope; the on-disk profile export is stale (`gameCount: 0` vs 278 stored games); D-089 `blendMode` is PROPOSED.
- Deleting would break: the whole profile pipeline and v2 scope. **Keep for v2, rework role scope.**

### 4.4 Threat/state/item code (D-081..D-087, D-093, D-095)

- What exists: engine `threat.ts`, `item-context.ts`, `items/{analytic,config,context,recommend,types}.ts`; ETL `aggregate-items.ts`, `item-classes.ts`, `timeline*.ts`, `challenges*.ts`, `lane-arch.test.ts`, tables `item_events`/`kill_events`/`lane_snapshots`/`participant_challenges`/`participant_starters`/`item_state_scale`/`item_build`.
- What reads it at runtime: the ETL aggregation reads timeline facts to build `item_build`, which exports `roles/SUPPORT/builds/*.json` (43 files) and `build-paths/*.json` (4 files). **No app code consumes builds yet** — `recommend-data.ts` loads only baseline/pairs/lane tables; there is no items UI. `recommendItems`/`computeThreatScores` have no production caller.
- Effect on exported numbers: `item_build` feeds only the builds exports; draft recommendations do not use it.
- Deleting would break: builds/build-paths exports, `timeline`/`backfill` commands' purpose, ~11.2M `item_events` rows become dead weight, and all of v3. All governing decisions are PROPOSED (D-109) — the owner decides whether the items rewrite keeps this design.

### 4.5 Image-recognition code

- **None exists.** No opencv.js/tesseract.js/onnxruntime dependency in any `package.json`; no capture/OCR modules under `packages/` or `apps/`. D-007's vision fallback and SPECS §9 remain unimplemented; D-105 keeps vision as fallback only.

## 5. Verified facts

### 5a. `exportMinGames` default

**Default = 10**, defined in `packages/engine/src/config.ts:121` (`DEFAULT_CONFIG.exportMinGames: 10`), schema-validated at line 73 with the constraint `exportMinGames <= minGames` (minGames = 25, line 108). It is an `n_eff` floor applied in `packages/etl/src/export/io.ts:36` (`passesGate`) to every exported row. GLOSSARY.md's "default value is unverified" note is now resolved.

### 5b. Patch label mapping (16.x data ↔ 26.x public)

**Verified for the current patch only.** Data Dragon `versions.json` (fetched 2026-11-15, no key) newest entry is `16.22.1` → label `16.22`; official patch notes publish "Patch 26.22" released 2026-11-04 (leagueoflegends.com patch-26-22-notes; community wiki `V26.22`). So public `26.22` ↔ data `16.22`, consistent with the +10-major hypothesis in D-108. Whether the offset holds for the whole history (e.g. public 26.1 ↔ 16.1, and whether a public 25.x series existed ↔ 15.x) is **unverified** — needs one more anchor check before coding the mapping.

### 5c. TOP/JUNGLE statistics: aggregated yes, exported no

Aggregate tables contain rows for **all five roles** (verified by `GROUP BY my_role`):

| Table      | ADC     | JUNGLE  | MID     | SUPPORT | TOP     |
| ---------- | ------- | ------- | ------- | ------- | ------- |
| baseline   | 1,112   | 928     | 1,232   | 1,128   | 1,296   |
| pair_ally  | 146,312 | 163,104 | 183,208 | 148,480 | 197,488 |
| lane_vs    | 184,160 | 37,536  | 51,536  | 184,816 | 65,472  |
| lane_full  | 335,632 | —       | —       | 335,632 | —       |
| item_build | 15,923  | 16,005  | 17,372  | 100,919 | 19,649  |
| rune_ctx   | 95,058  | 38,047  | 55,340  | 866,578 | 67,020  |

(lane_full only exists for 2v2 lane groups — SUPPORT/ADC.) Raw participant games per role: 48,650 each (24,325 matches × 2 sides). **However `data/public/16.22/` exports only `roles/SUPPORT/`** — `manifest.roles = ["SUPPORT"]`. Re-running `pnpm etl export` with TOP/JUNGLE added to the role list would produce their files from existing aggregates; no re-aggregation is needed. Caveat from PROGRESS (2026-11-06, SUPPORT data): below `minGames` almost all pair/lane rows fail the n_eff gate — TOP/JUNGLE will be thinner still; sample sizes must be checked per file before relying on them (golden rule 8).

### 5d. Player selection for ingestion; pool steering

- Discovery (`players.ts`): tiers EMERALD→CHALLENGER, quotas 250/250/150/100/100 (`DEFAULT_PLAYER_QUOTAS`), apex leagues sorted by `leaguePoints` desc, other tiers paged league entries; tier refresh skipped if completed < 7 days.
- Match ingestion (`matches.ts:180-210`): all `players` rows ordered by `rank_score DESC`, pending cursors first then done; `--limit N` slices; `--refresh` restricts to players with existing cursors. Each ingested match stores **all 10 participants** with champion+role, so every player's games feed every champion×role cell.
- **Pool steering: not implemented.** There is no champion-aware player selection — you cannot ask Riot "who plays Shen"; the only lever is which discovered players get ingested. `participants.champion_games` (per puuid×champion) already records who plays what, so a D-102 "pool-driven collection" could prioritize pending players whose stored rows include pool champion×role pairs — but that requires new selection logic; today `--limit` is rank-order only. Feasible without new API endpoints.

### 5e. `pnpm etl pull` requirements and token-free download

- `pull` (`commands/pull.ts`, `state-release.ts`) requires: `gh` CLI installed **and** `gh auth status` passing (`ghReady()`), a state repo defaulting to `<origin-owner>/draftorb-state` (**private**, D-078), then `gh release download` of `public-exports.tar.gz` (and optionally `DraftOrb.sqlite.gz` with `--db`). No token flag exists — it relies on the user's gh authentication, which needs read access to the private repo.
- **A program cannot download the aggregates at launch with no token today**: the repo is private, so anonymous HTTPS fails. D-099's open item — publishing `public-exports.tar.gz` (or the patch dir) as a **public** release asset — is required. All files under `data/public/16.22/` contain only champion/item/rune ids and weighted counts: verified by grep — the only pattern hits were sha256 file hashes in `manifest.json` and the owner's own `riotId`/`label` in `profiles/*.json` (explicitly allowed by D-069). **No PUUIDs, match ids, or foreign player names exist in any exported file** — the whole `data/public` tree (patch exports + `backtest-draft.json` + `joint-model.json` + `profiles/`) is safe to publish. `champions.bootstrap.json`/`champions.derived.json` are internal snapshots, also id-only.
- Note: `profiles/kiritoctoc-euw1.json` contains the owner's Riot ID (`KiriToc#Toc`) by documented choice; if "shareable code" (D-096) ever means other users, that file should not ship publicly — it is currently consistent with "profile data stays private" only if the state repo stays private.

### 5f. Item slots and quest items vs D-106

Current model (D-082/D-083, `item-classes.ts`, `item-context.ts`, `aggregate-items.ts`):

- `classifyItem` assigns classes: `starter`, `quest_line`, `quest_reward`, `jungle_path`, `component`, `boots`, `completed`, `consumable`, `excluded`. Support quest ids are **hardcoded** (`SUPPORT_QUEST_LINE_IDS` 3865-3868, rewards 3869-3877) plus `Quest`+`Support`/`Lane` tag heuristics; jungle pets hardcoded (1101-1107, 1203-1216).
- `slot_idx`: net replay of raw `item_events` (undo/sold/destroyed net out); slot 0 = purchases within `starterWindowSeconds` (45 s); completed index counts `completed`+`boots` classes (`ownedCompletedCount`, items/context.ts:81).
- Quest-line/reward/jungle-path items never occupy slots; `decision_kind='path'` rows go to `build-paths/`.

What must change for D-106 (patch 26.1 role quests):

1. **ADC boots 7th slot**: today boots are folded into the same completed count as legendaries; there is no separation of "boots slot" vs "item slots" and no quest-completion state. Needs: track quest progress per participant (role-quest completion is a timeline/challenge fact — `participant_challenges` exists but quest state extraction is unverified), model boots as a separate slot dimension, and the "6 items + boots" display rule.
2. **Mid free tier-3 boots**: granted, not purchased → produces no `item_events` purchase row; needs a granted-item path or quest-completion fact, else mid builds will show a phantom empty boots slot.
3. **Support control-ward slot (up to 2)**: wards are `consumable`/`Trinket` today and never counted; needs a dedicated quest-slot class and counting rule (2 charges, not items).
4. **Top TP quest upgrade**: affects summoner-spell advice (v2) — no summoner-advice code exists yet; Top quest data source unverified.
5. All of the above are PROPOSED-scope (D-109 folds D-082/D-083/D-087/D-095 into the items rewrite) — treat current item code as reference, not foundation.

### 5g. Enemy role inference and bans

- Role inference exists and is solid: `packages/engine/src/roles.ts` `inferRoles` (exact assignment over `roleProb`, per-slot + team confidence, `excludedRoles`), `recommend-*.ts` wires it for allies and enemies; D-050 reserves `userRole` on the ally team. SPECS §4 implemented; tests in `roles.test.ts`, `recommend-role-conflicts*.test.ts`.
- Web UI: enemies are entered **without** a required role (role dropdown exists per slot and acts as the D-104 manual override); the user slot hides the role picker (`showRole={false}`, DraftScreen.tsx:449).
- **Bans: documented but not implemented.** SPECS §2 declares `bans?: ChampionId[]` (D-106) but `draftInputSchema` (`schemas/draft.ts:25-34`, `.strict()`) has no `bans` field, the engine never reads one, and no UI exists. This is a spec/code gap for v1 — the new program must add it (excluded from recommendations and enemy role assignment per D-106).

### 5h. Database size and match count

DB exists (see §2.1): 5,671,165,952 bytes (~5.28 GiB), 24,325 matches, 243,250 participants, 19,340 players, 559 rejects, 319 patch labels. Matches span only patches 16.10–16.22 despite a 20-patch retention window — earlier patches were pruned or never ingested (unverified which; `match_rejects` has only 559 rows so most absence is "never ingested", not tombstones).

Compressed size (measured 2026-11-15, read-only stream, no copy): `gzip -1 -c data/DraftOrb.sqlite | wc -c` → **1,005,445,369 bytes (~0.94 GiB / 933 MiB)**. This is **under the 2 GiB GitHub release-asset limit** cited in D-091, so the whole DB could technically ship as one release asset — but it is ~2x the ~475 MiB figure in D-091 (which predates the timeline/challenge/lane-snapshot backfills). Per D-099 only the small `data/public` exports (~9.2 MB uncompressed) need to be public; the DB stays private either way.

Table size dominance (`dbstat`, bytes of pages): `item_events` is the overwhelming majority — table 1,475,960,832 + `idx_item_events_puuid` 1,436,528,640 + autoindex 488,169,472 + `idx_item_events_match_ts` 407,810,048 ≈ **3.81 GB (~72% of the file)**. Next: `rune_ctx` ~627 MB (table + autoindex), `participants` 166 MB, `participant_challenges` 164 MB, `pair_enemy`/`pair_ally` ~104 MB combined, `kill_events` ~115 MB (table + indexes), `lane_snapshots` ~98 MB. Everything else is <60 MB each. Conclusion: the 5.28 GiB is almost entirely timeline item-event data — consistent with `backfill-timelines` having run on 10,633 matches; `entity_change_scores`/`data_breakpoints` are empty.

### 5i. Habit concentration for pool champions (SUPPORT/TOP/JUNGLE)

Champion ids resolved **by name** from `data/public/16.22/champions.json` (`name` field → `id`): **Shen = 98, Nami = 267, Maokai = 57, Teemo = 17**. (Correction: the first pass of this audit queried ids 50/145/78/17, which are Swain/Kai'Sa/Poppy/Teemo — those rows were wrong and are replaced here. Teemo=17 was already correct.) `champions.json` role tags: Shen TOP/JUNGLE/SUPPORT, Maokai TOP/JUNGLE/SUPPORT, Teemo TOP/JUNGLE, Nami SUPPORT only.

Computed read-only over all stored `participants` rows (unweighted counts; `champion_id` × `role` × `puuid`):

| Champ  | Role    | Games | Distinct players | Top-3 players' share |
| ------ | ------- | ----- | ---------------- | -------------------- |
| Teemo  | TOP     | 590   | 228              | 37.1%                |
| Teemo  | JUNGLE  | 113   | 31               | 59.3%                |
| Teemo  | SUPPORT | 23    | 18               | 34.8%                |
| Shen   | TOP     | 998   | 481              | 12.6%                |
| Shen   | SUPPORT | 118   | 72               | 28.8%                |
| Shen   | JUNGLE  | 112   | 70               | 19.6%                |
| Maokai | TOP     | 83    | 51               | 28.9%                |
| Maokai | JUNGLE  | 192   | 103              | 18.2%                |
| Maokai | SUPPORT | 244   | 166              | 11.9%                |
| Nami   | SUPPORT | 1,966 | 1,103            | 4.7%                 |

Nami has **no TOP or JUNGLE rows** (consistent with its SUPPORT-only role tag; participants only store observed role assignments, and Nami was never assigned TOP/JUNGLE in the seed population). No cell has zero games now — unlike the first pass, every queried champion×role pair has data, though Teemo/Support (23 games) remains thin.

Evidence for D-102's per-player cap: several pool-relevant cells are dominated by few players — Teemo/Jungle top-3 = 59.3% of 113 games, Teemo/Top 37.1% of 590, Shen/Support 28.8% of 118, Maokai/Top 28.9% of 83. The best-covered cells are healthier: Nami/Support 1,966 games / 1,103 players / top-3 only 4.7%; Shen/Top 998 / 481 / 12.6%. Caveat: raw unweighted counts over a Champion+-heavy seed population (players are top-ranked seeds, §5d), so shares measure seed-pool habits, not the general population; `participants.puuid` is the dedup key used.

### 5j. Windows readiness checks

- **CI Windows runner: yes.** `.github/workflows/ci.yml` `test` job runs `runs-on: ${{ matrix.os }}` with `os: [ubuntu-latest, windows-latest]` on Node 22 — `pnpm install --frozen-lockfile` + `pnpm test` already execute on Windows in CI. The `lint`/`format` jobs and `etl.yml` are ubuntu-only.
- **`better-sqlite3` Windows prebuilds for Node 22: yes.** Installed version `better-sqlite3@13.0.3` (`packages/etl/package.json:18`, `engines.node >= 22`) ships `prebuilds/win32-x64.node` and `prebuilds/win32-arm64.node` in the published package (verified in `node_modules/.pnpm/better-sqlite3@13.0.3/.../prebuilds/`), alongside linux/darwin variants — no compiler needed on Windows, matching AGENTS.md rule 4.
- **Unverified on Windows:** (a) whether `pnpm etl` commands actually run end-to-end on Windows (ETL workflow is ubuntu-only; path handling uses `path.join` per convention but no Windows ETL CI exists); (b) `gh` CLI availability/behavior on Windows for `etl pull`/`publish` (§5e); (c) SQLite `immutable=1`/WAL behavior on Windows (the read-only open issue in §2.1 was hit on macOS); (d) the future desktop shell itself — nothing exists yet (`apps/desktop` absent, §3).

### 5k. Real draft backtest evidence

A real backtest **was** produced during the Phase-0 model review (2026-11-12), documented in `docs/reports/model-review-baseline.md` §(c): `pnpm etl backtest draft`, holdout = patch **16.22**, training = **10,379 games** on 11 earlier patches, holdout = **13,946 games**. Results: engine log-loss **0.6967** vs champion-baseline-only **0.6946** (engine _worse_ than baseline), Brier 0.2517 vs 0.2507; SUPPORT per-role log-loss 0.6981; predictions miscalibrated in the tails. The raw report was written to `/tmp/backtest-baseline.json` — **not committed**; only the summary survives in the report.

The committed `data/public/backtest-draft.json` is an **empty placeholder** (`holdoutGames: 0`, all metrics null, `insufficientData: true`) — it does not reflect the real run above.

`data/public/joint-model.json` does contain a `validation` block (evalPatch 16.22; train 10,379 / eval 14,946 matches; joint top1 0.0427, hybrid top1 0.0650 ≈ prior 0.0650) but `status: "unvalidated"` — consistent with §4.2 (D-092 gate failed; nothing consumes it).

## 6. Language comparison

Criteria: startup time, memory, engine reuse (backtest + ETL), Windows setup effort, risk when AI sessions write the code, rework cost. All timings are **estimates**, not measurements.

| Criterion                       | A. TypeScript + light shell (Tauri)                                                          | B. Full Rust                                                                | C. Electron                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Startup time                    | Fast (~1-3 s est.: native shell + V8/JIT)                                                    | Fastest (~100-500 ms est.)                                                  | Slowest (~2-5 s est., Chromium boot)                                                |
| Memory                          | Low (~150-400 MB est.)                                                                       | Lowest (~50-150 MB est.)                                                    | Highest (~400-800 MB est.)                                                          |
| Engine reuse in backtest/ETL    | Direct — same TS package runs in Node/vitest today                                           | Port required (rewrite or FFI/WASM bridge)                                  | Direct — same as A                                                                  |
| Windows setup effort            | Node+pnpm+Rust(Tauri build) or prebuilt; moderate                                            | Rust toolchain; cargo is heavier for AI sessions                            | Node+pnpm only; heaviest runtime deps                                               |
| AI-session code risk            | Lowest — existing strict TS + 1237 tests + zod contracts reuse                               | Medium — new language, new test harness, no existing Rust code              | Low-medium — same TS, but Electron IPC/main-process bugs are a classic failure mode |
| Rework cost                     | Lowest — `packages/engine`/`shared`/`etl` reused as-is; web UI largely portable to a webview | Highest — engine port or dual implementation; backtest must be re-validated | Medium — engine reusable; UI portable; shell is throwaway-ish                       |
| Data download at launch (D-099) | `fetch` in webview or Rust side; trivial                                                     | `reqwest`; trivial                                                          | `fetch`/Node; trivial                                                               |
| Free/100% constraint            | All options free; Tauri/Rust and Electron both OSS                                           | Free                                                                        | Free                                                                                |

**Recommendation: A — TypeScript with a Tauri shell.** The engine is pure TS with a strict test suite and the ETL/backtest already run it in Node; Tauri gives a native Windows binary with fast startup and low memory, keeps one language (D-001 spirit, D-098-compliant since the shell language is now open), and minimizes rework. B (full Rust) buys the smallest footprint but forces a port of ~4k lines of engine plus re-validation of the backtest — poor cost/benefit for a single-user tool. C (Electron) reuses everything but is the heaviest option on the exact criteria GOALS.md cares about ("starts in seconds, light on resources"). The owner decides (D-098/D-099 open item). Windows-specific evidence supporting A: CI already runs the test suite on `windows-latest` (§5j), and `better-sqlite3` ships Node-22 Windows prebuilds — the riskiest native dependency is already covered.

## 7. Doc hygiene — contradictions and stale statements

| Location                                                                   | Statement                                              | Problem                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/ARCHITECTURE.md:3`                                                   | "apps/web is a scaffold (stub app, T-030 not started)" | Stale — the web app is functional (draft screen, pool, runes panel).                                                                                                                       |
| `docs/ARCHITECTURE.md:66,72`                                               | "`latest.json` is not yet written by export"           | Stale — `data/public/latest.json` exists (written 2026-11-13, D-051 implemented).                                                                                                          |
| `docs/DATA_MODEL.md:159`                                                   | "Phase 1 populates only `my_role = 'SUPPORT'`"         | Stale vs D-097 — TOP/JUNGLE are in scope; aggregates already exist for all roles (§5c).                                                                                                    |
| `docs/GLOSSARY.md:33`                                                      | "exportMinGames … default value is unverified"         | Resolved — default is 10 (`engine/src/config.ts:121`).                                                                                                                                     |
| `docs/SPECS.md:24` vs `packages/shared/src/schemas/draft.ts`               | `bans?: ChampionId[]` in spec                          | Not implemented anywhere (schema is `.strict()` without `bans`); v1 requires it (D-106).                                                                                                   |
| `docs/SPECS.md` §18 / `personalize.ts:183,270`, `profile-setup.ts:120,152` | Profile scope "Support, Top and Jungle" (D-097)        | Engine still filters `role !== 'SUPPORT'` — personalization is SUPPORT-only in code.                                                                                                       |
| `docs/PROGRESS.md:67`                                                      | "etl.yml cron DISABLED — workflow_dispatch only"       | Stale vs `.github/workflows/etl.yml:32` (`cron: '37 */12 * * *'`, re-enabled by D-094). PROGRESS.md already carries an OBSOLETE banner, but the newest session entries postdate it.        |
| `docs/TICKETS.md`, `docs/PROGRESS.md`                                      | Whole files                                            | Bannered OBSOLETE at audit time; those tracking files and `docs/BACKLOG.md` have since been retired — current work is tracked in GitHub issues/project.                                    |
| `docs/DECISIONS_AMENDMENTS.md`                                             | "Merged into DECISIONS.md … kept as a record only"     | Correct — no action.                                                                                                                                                                       |
| Broken links                                                               | —                                                      | None found at audit time; `PROGRESS_ARCHIVE.md`, `reports/`, `proposed-etl-schedule.md` existed then. `PROGRESS*.md`, `TICKETS.md`, `PROMPTS.md` and `BACKLOG.md` have since been retired. |

## 8. Questions for the owner

1. **Language for the Windows program?** Recommendation: TypeScript + Tauri (§6). Alternatives: full Rust (best footprint, highest rework) or Electron (max reuse, heaviest). Owner decides per D-098/D-099.
2. **Where to publish shared aggregates for token-free launch download?** Recommendation: a **public** GitHub release asset (e.g. `public-exports.tar.gz` or the `data/public/<patch>/` tree) in the main repo or a dedicated public repo — all exported files verified free of PUUIDs/match ids/foreign names (§5e). Keep `profiles/` and the SQLite DB in the private state repo.
3. **Cut the joint model?** Recommendation: delete `engine/src/joint`, `etl joint-fit`/`fit-model`, and `joint-model.json` — both gates failed and nothing consumes it (§4.2). Keep the decision log entries.
4. **Item/threat code disposition?** All governing decisions are PROPOSED (D-109) and the slot model predates the 2026 role quests. Recommendation: keep the ETL timeline extraction (raw facts are valuable and decision-agnostic) but plan the engine items layer as a rewrite; do not delete `item_events`/`kill_events` data. Owner to confirm when approving the items phase.
5. **Bans + TOP/JUNGLE scope for v1?** `bans` is in SPECS but unimplemented; TOP/JUNGLE aggregates exist but are unexported and likely thin. Recommendation: add `bans` to the new program's input contract first (cheap, spec'd), and export TOP/JUNGLE with per-file sample-size checks before enabling those roles in the UI.
