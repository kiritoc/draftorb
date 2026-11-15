# DECISIONS AMENDMENTS (2026-11-15)

Append the entries below to DECISIONS.md and apply the status changes in the last section. All entries are owner-approved in the goal interview of 2026-11-15.

### D-096 — Product audience: one player, shareable code — ACCEPTED (owner, 2026-11-15)

The tool is for one player (KiriToc, Diamond, EUW1). The code may be shared; the player's profile and pool stay local. Shared aggregate statistics contain no PUUIDs and may be published; profile data stays private. PUUIDs are encrypted per API key (D-060), so another user cannot reuse this database and needs their own key for profile sync. Amends D-067, D-068, D-069, D-074 (remove the "public app" and "visitor" premise).

### D-097 — Role scope: Support, Top, Jungle in full; ADC and Mid minimal — ACCEPTED (owner, 2026-11-15)

Usage is about 70% Support, 29.5% Top/Jungle, 0.5% ADC/Mid. Supersedes D-005. Amends D-023 (backtest runs for SUPPORT, TOP, JUNGLE), D-073 and D-074 (profile scope is no longer Support-only). ADC and Mid get champion-level statistics only until a later decision.

### D-098 — Restart the code, keep the data pipeline — ACCEPTED (owner, 2026-11-15)

Restart the engine and app from GOALS.md. Keep the SQLite database and the scheduled pipeline (D-003, D-094). A time-boxed audit judges existing modules by interface (database schema, export formats) as keep / rewrite / delete. The implementation language is decided after the audit. Amends D-001 ("TypeScript everywhere" no longer binding for the desktop shell). No PROPOSED decision is implemented before owner approval.

### D-099 — Windows 11 desktop program; data fetched online at launch — ACCEPTED (owner, 2026-11-15)

The app is a light, fast-starting Windows 11 program that may be compiled locally. It downloads the latest data at launch. Supersedes the "static site / local dev server" parts of D-002 and D-079 (the no-hosting rule stands). Recommended data location (open, pending the first ticket): shared aggregates as a public release asset (no token needed), profile data private. Note: `pnpm etl pull` currently relies on the GitHub CLI and a private repo (D-079).

### D-100 — Build order and version 1 — ACCEPTED (owner, 2026-11-15)

Priority order: (1) champion pick screen, (2) runes and summoners with starters, (3) in-game items with auto-fill. Version 1 is the pick screen with an "Unvalidated model" label (D-023). The player's own record appears as a badge on each champion card; the blended "my results" ranking moves to version 2. Amends D-072 (the third list "KiriToc's picks" is not in version 1).

### D-101 — Pool: per role, champion x roles, highlight only — ACCEPTED (owner, 2026-11-15)

The pool editor lets the player pick a champion once and tick the roles it applies to. Pool champions are highlighted, never filtered or boosted; "From your pool" stays above "Best overall" with "In pool" tags and both ranks. The pool is stored by the program, not browser localStorage. Amends D-024; D-053 (champion portraits next to names) stands.

### D-102 — Evidence rule for runes, summoners and items — ACCEPTED (owner, 2026-11-15)

Keep the expert filter (D-022). Add a per-player cap on each player's weight within a context and a minimum number of distinct players behind any number. Show win rate and pick share separately. "Master+ only" is an optional toggle, off by default. Collect extra data for the champion-role pairs in the player's pool (pool-driven collection); the draft ranking keeps using broad data. Values for the cap and minimum are set by the backtest. Amends D-021, D-022, D-045.

### D-103 — Thin-data fallback — ACCEPTED (owner, 2026-11-15)

When data is too thin: picks and runes show a broader statistic (for example the champion's win rate in that role), clearly labeled; items show a rule-based suggestion (D-093 analytic fallback), clearly labeled as a rule. D-054 stands. D-087 measured a median of 2 games per champion-and-slot cell for items.

### D-104 — Enemy roles and "safe" pick — ACCEPTED (owner, 2026-11-15)

Enemy champions are entered without roles; the tool infers roles with a confidence and the player can override (SPECS §4; D-050 stands). "Safe" means: counter the known opponent; with no opponent known, a pick that is hard to counter (D-030 blind safety).

### D-105 — Auto-fill from the game client — ACCEPTED (owner, 2026-11-15)

Draft and in-game data are read from the LCU and the Live Client Data API. Screenshot import is dropped from the plan and kept only as a fallback if client access is not allowed or does not work (D-007 stands). First ticket of the live phase: read Riot's policy on in-game advice tools and record the result in DECISIONS.md. Gold is not exposed for other players, so win/lose/even is an estimate; the threat score (D-081) uses kills, deaths, assists and items.

### D-106 — Bans and item slots — ACCEPTED (owner, 2026-11-15)

Bans come from the draft screen. Version 1 has a manual bans input; banned champions are excluded from recommendations and from enemy role assignment. Since patch 26.1 the ADC role quest moves boots into a separate seventh slot (6 items plus boots); mid gets free tier 3 boots; Support gets a role-quest slot for up to 2 Control Wards. Build display rule: up to 6 inventory items including boots, and ADC gets boots as a seventh slot after the quest. D-082 and D-083 (item slots, quest items) must be extended to these role quests. Top's quest upgrades Teleport; check the effect on summoner advice in the runes and summoners phase.

### D-107 — Look and feel — ACCEPTED (owner, 2026-11-15)

Visual direction C (light, clean, large targets) with a light/dark toggle that remembers the last choice. Assumption: the first launch follows the Windows theme. The style canvas lives at the artifact link shared in the interview.

### D-108 — Patch naming — ACCEPTED (owner, 2026-11-15)

The interface shows the public patch name (for example 26.22). Internal data keeps Riot's data label (for example 16.22) as `major.minor`. The mapping appears to add 10 to the major number; this is unverified and needs a check against Data Dragon before it is coded. Amends D-043.

### D-109 — Handling of the 14 PROPOSED decisions — ACCEPTED (owner, 2026-11-15)

None is auto-approved; each needs an explicit owner OK when its phase starts.

- Items and live game, kept as design direction: D-081, D-083, D-084, D-085, D-086, D-093.
- Fold into the items rewrite: D-082, D-087, D-095.
- Version 2: D-089.
- Draft-model experiments, used only by the backtest until validated: D-088, D-090, D-092, D-092a.

## Status changes to apply to existing entries

| Entry                                                                | Change                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| D-005                                                                | SUPERSEDED by D-097                                                               |
| D-057, D-070                                                         | SUPERSEDED by D-078 (state moved to private release assets)                       |
| D-071                                                                | Note: the production-key question is resolved by D-091 (personal product)         |
| D-058, D-059                                                         | Body says PROPOSED but header says ACCEPTED: confirmed by the owner on 2026-11-15 |
| D-091                                                                | Add "amended by D-094" to the header                                              |
| D-001, D-002, D-024, D-067, D-068, D-069, D-072, D-073, D-074, D-079 | Add "amended by D-096 to D-101" as applicable                                     |
| D-021, D-022, D-045                                                  | Add "amended by D-102"                                                            |
| D-043                                                                | Add "amended by D-108"                                                            |

Housekeeping: delete the unfilled "D-xxx" template; note that D-037 to D-042 are intentionally unused (or restore them if they exist elsewhere); keep the note that D-028 was renumbered from D-025.
