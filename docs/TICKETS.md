# TICKETS
Format: `ID | Title | Deps | Status | Acceptance`. Status: TODO, DOING, REVIEW, DONE, BLOCKED. Only one ticket DOING per AI session. Size: S (<1h), M (half day), L (1 day). When a ticket is too big, split it and add sub-tickets (T-xxx.a).

## E0 Foundations
- **T-001 | Monorepo scaffold (S)** | – | DONE | pnpm workspaces (`shared, engine, etl, web`), TS strict base config, Vitest, ESLint, Prettier, scripts `dev/test/typecheck/lint`. Acceptance: `pnpm install && pnpm test && pnpm typecheck` pass on clean Windows machine.
- **T-002 | Shared types + zod schemas (M)** | T-001 | DONE | Types for Champion, Role, Rank, DraftInput, Slot, Recommendation, GameState, data JSON formats (DATA_MODEL.md). Acceptance: schemas + unit tests; no logic.
- **T-003 | Data Dragon importer (S)** | T-002 | DONE | Script downloads latest version champions/items/runes -> `data/public/<patch>/champions.json, items.json, runes.json`. Acceptance: runs with `pnpm etl static`, validated by zod.
- **T-004 | Support champion tags (M)** | T-003 | DONE | `data/manual/champion-tags.json` with all supports + common flex picks, schema in shared. Acceptance: validation script passes; coverage report lists missing champions.

## E1 ETL
- **T-010 | Riot client + rate limiter (M)** | T-001 | DONE | See RIOT_API.md. Acceptance: tests with mocked HTTP for 429/5xx/401 and rate limiting.
- **T-011 | SQLite schema + migrations (S)** | T-001 | DONE | DATA_MODEL.md tables, migration runner. Acceptance: `pnpm etl migrate` idempotent; `getMigrationStatus()` reports pending from disk and flags applied versions missing from the migration directory without negative counts; SQLite connection enables `foreign_keys` and any temporary disable happens before `BEGIN IMMEDIATE`.
- **T-012 | Player discovery by tier (M)** | T-010,T-011 | DONE | Collect players Emerald..Challenger (config), store rank_score. Acceptance: resumable, per-tier quotas.
- **T-013 | Match ingestion (L)** | T-012 | TODO | Fetch ranked solo matches per player, dedupe, patch filter, store. Acceptance: kill/restart resumes; progress log; no duplicate rows.
- **T-014 | Participant extraction (M)** | T-013 | TODO | Roles, champion, runes, items, result, rank snapshot, champion_games (optional mastery). Acceptance: fixtures from real match JSON in tests.
- **T-015 | Aggregate role probabilities (S)** | T-014 | TODO | `role_prob`. Acceptance: probs sum to 1 per champion; test.
- **T-016 | Aggregate baselines (support, rank-weighted) (S)** | T-014,T-020 | TODO | Uses engine rank kernel. Acceptance: weighted counts verified on toy data.
- **T-017 | Aggregate pair tables (M)** | T-016 | TODO | ally (ADC/jungle/mid/top) + enemy (all roles) for supports. Acceptance: toy dataset gives expected counts; both team perspectives handled.
- **T-018 | Aggregate runes by context (M)** | T-014,T-020 | TODO | Experts rule SPECS §3. Acceptance: min-games filter works.
- **T-019 | Export versioned JSON + manifest (S)** | T-015..T-018 | TODO | Files in DATA_MODEL.md, size checks. Acceptance: web can load them; schemaVersion present.

## E2 Engine
- **T-020 | Rank weighting module (S)** | T-002 | TODO | Kernel + experts weights + recency decay, config-driven. Acceptance: unit tests on boundary values.
- **T-021 | Role inference (M)** | T-002 | TODO | SPECS §4 with confidence. Acceptance: tests incl. flex champions, partially known roles.
- **T-022 | Shrinkage + level mapping (S)** | T-002 | TODO | SPECS §5. Acceptance: tests (low n -> lowData).
- **T-023 | Support recommendation + explanations (L)** | T-020..T-022 | TODO | SPECS §5-7. Acceptance: golden tests pass (TESTING.md).
- **T-024 | Blind pick mode (M)** | T-023 | TODO | blindSafety. Acceptance: with no enemies, ranking = safe picks; test.
- **T-025 | Comp needs (M)** | T-004,T-023 | TODO | damage mix/engage/frontline needs. Acceptance: explained in reasons.
- **T-026 | Golden test suite (M)** | T-023 | TODO | 20+ scenarios (blind, 1 champ known, full draft, unknown roles, low data).

## E3 Web MVP
- **T-030 | Web scaffold + data loader (S)** | T-001,T-019 | TODO | Vite/React/Tailwind, loads manifest + JSON, shows patch. Acceptance: runs with sample data.
- **T-031 | Draft screen (L)** | T-030 | TODO | 10 slots, searchable champion picker, optional role per slot, blind toggle, rank selector (Diamond default). Acceptance: any subset of inputs OK.
- **T-032 | Recommendations list (M)** | T-023,T-031 | TODO | Cards with reasons, level badges, sample sizes, lowData warning.
- **T-033 | Pool filter (S)** | T-032 | TODO | Manual champion pool in localStorage; second list "from my pool".
- **T-034 | Static deploy (S)** | T-032 | TODO | GitHub Pages/Cloudflare Pages + Action. Acceptance: public URL works. Legal footer.

## E4 Runes
- **T-040 | Rune recommender in engine (M)** | T-018,T-023 | TODO | SPECS §8.1.
- **T-041 | Runes UI (M)** | T-040,T-032 | TODO | Rune page display (icons), adaptation hints.
- **T-042 | Gameplan notes (S)** | T-032 | TODO | Markdown per champion displayed after pick.

## E5 Items
- **T-050 | Item tags catalog (M)** | T-003 | TODO | `item-tags.json` (armor/MR/antiheal/shield-breaker/burst/etc.).
- **T-051 | Timeline ingestion + item builds aggregation (L)** | T-019 | TODO | `item_events`, `item_build`.
- **T-052 | GameState model (S)** | T-002 | TODO | Types + zod.
- **T-053 | Threat score (M)** | T-052 | TODO | SPECS §8.2.2. Acceptance: tests with fed/not fed scenarios.
- **T-054 | Item recommender v1 (rules) (L)** | T-050,T-053 | TODO | ahead/behind logic, fed counter-items, reasons.
- **T-055 | Items UI (manual input) (L)** | T-054 | TODO | Fast entry of scores+items per player.
- **T-056 | Item recommender v2 (data-driven) (L)** | T-051,T-054 | TODO | Context winrates replace rules where data is sufficient.

## E6 Live
- **T-060 | LCU champ select adapter (M)** | T-031 | TODO | Reads session, emits DraftInput. Policy check recorded in DECISIONS.md.
- **T-061 | Live Client Data adapter (M)** | T-055 | TODO | Emits GameState; estimate gold from items.
- **T-062 | Electron shell + overlay (L)** | T-060,T-061 | TODO | Windows installer, minimal setup.

## E7 Vision
- **T-070 | Screen capture module (M)** | T-062 | TODO
- **T-071 | Champ select portrait recognition (L)** | T-070 | TODO | Template matching vs Data Dragon icons.
- **T-072 | Scoreboard items + KDA OCR (L)** | T-070 | TODO
- **T-073 | Correction UI (M)** | T-071 | TODO | Edit any detected value before computing.
- **T-074 | Evaluation harness (M)** | T-071 | TODO | Screenshot dataset, accuracy report across resolutions/UI scales.

## Ticket template
```
### T-xxx — Title
- Epic / Size / Deps
- Context (why)
- Scope (do) / Out of scope (don't)
- Acceptance criteria (testable)
- Files likely touched
- Notes
```
