# PLAN SUMMARY

## Vision

A personal Windows 11 companion for one player (KiriToc, Diamond, EUW) that runs next to the game and answers three questions:

1. **Champion select:** given my locked allies and enemies, which champion should I pick — and is there a better one than my usual?
2. **After I lock in:** which runes, summoner spells and starting items?
3. **In game:** which item next, depending on whether I am winning, losing or even, who is fed, and what I should sell?

The code can be shared; the data (profile, pool) is tied to one player. Source of truth: `docs/GOALS.md`; rationale: `docs/DECISIONS.md` (D-096..D-109 approved 2026-11-15).

Inspirations: coachkarakal.com/drafting (support picks by synergy/counter with levels 1-3, blind-pick mode, gameplan) and coachless.gg (stat-driven builds/runes, WPA = win probability added).
Our approach = **hybrid**: stats-driven engine + thin manual layer (champion tags, item tags, gameplan notes).

## Scope

**Roles:** Support (~70% of games), Top and Jungle in full (~29.5%), ADC and Mid minimal (~0.5%, champion-level statistics only). See D-097.

**Versions** (D-100):

| Version | Contents                                                                                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1      | Pick screen for Support, Top, Jungle (ADC/Mid minimal). Per-role pool editor (champion x roles). Manual draft and bans input. Enemy role inference with confidence + override. Thin-data fallback. "Unvalidated model" label until the backtest passes. Personal record as a badge. Light/dark toggle. Data downloaded at launch. |
| v2      | Runes, summoners and starters (top players / my data modes). Blended "my results" ranking.                                                                                                                                                                                                                                        |
| v3      | In-game items with automatic game-client data (LCU + Live Client API). Sell advice, fed enemy/ally option.                                                                                                                                                                                                                        |
| Later   | Per-rune usefulness for the player, hand-written counter notes, screenshot import as fallback only.                                                                                                                                                                                                                               |

## Constraints

- 100% free (no paid API/LLM/hosting). Riot API only (free personal key, D-091/D-094).
- TypeScript everywhere for engine/ETL/shared (strict); the Windows desktop shell language is decided after the code audit (D-098/D-099).
- Windows 11 first, minimal setup; the program starts in seconds and downloads the latest data at launch.
- Vibe-coded with several different AIs -> docs-driven workflow (`docs/WORKFLOW.md`).
- No runtime AI; scoring is deterministic stats + manual tags (D-006).
- Profile data is private; only shared aggregate statistics (no PUUIDs) may be published (D-096).

## Key product decisions

- **Pool highlights, never scores:** the personal champion pool (champion x roles, stored by the program) groups and tags results but never changes `score(c)` (D-024 as amended by D-101). "From your pool" sits above "Best overall"; both paginate 5-by-5.
- **Honest numbers:** every figure shows its sample size; thin data falls back to a broader statistic or a labeled rule, never an invented number (D-054, D-103).
- **Evidence, not habit:** experts only, plus a per-player cap and a minimum number of distinct players; win rate and pick share shown separately (D-102).
- **Prove before trusting:** the draft ranking carries an "unvalidated" label until the offline backtest passes for SUPPORT, TOP and JUNGLE (D-023 as amended by D-097).
- **Personalization (v2):** a configured profile's own record blends into a separate labeled list; `score(c)` stays unchanged (D-072/D-073 as amended).
- **Auto-fill (v3):** LCU + Live Client API first; screenshot/vision only as fallback if client access fails (D-105).
- **Patch naming:** interface shows the public name (26.x); internal data keeps Riot's label (16.x); the +10 offset is unverified (D-108).

## Roadmap (versions, not epics)

| Version | Milestone                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| v1      | Pick screen (pool editor, manual draft/bans, enemy role inference, unvalidated label, badge, theme toggle) |
| v2      | Runes, summoners, starters; blended "my results" ranking                                                   |
| v3      | In-game items + auto-fill from the game client                                                             |

The existing ETL pipeline (SQLite, scheduled GitHub Actions, D-003/D-094) is kept and feeds the program's data download (D-098/D-099).

Run ETL collection in the background as early as possible — data volume is the main bottleneck.

## Risks

| Risk                                        | Mitigation                                                                                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Riot key expiry / rate limits               | Personal key (no expiry, D-091); resumable ingestion, rate limiter, rekey on key change (D-060)                                        |
| Not enough Diamond games for rare pairs     | Bayesian shrinkage + broader-statistic fallback + always show sample size (D-021, D-103)                                               |
| Expert (Master+) stats biased by one-tricks | Per-player cap + distinct-player minimum (D-102); show pick share separately                                                           |
| Patch changes invalidate data               | Patch-tagged data, recency decay, manifest with patch; public-name mapping unverified (D-108)                                          |
| Riot policy on in-game advice tools         | First ticket of the live phase; log result in DECISIONS.md (D-105)                                                                     |
| Implementation language for the shell       | Decided after the Stage-1 audit (TypeScript shell vs Rust vs Electron)                                                                 |
| Data download at launch without a token     | Open: shared aggregates as a public release asset recommended (D-099); `pnpm etl pull` currently needs the gh CLI + private state repo |
| AI drift between sessions                   | AGENTS.md rules, small tickets, tests, PROGRESS handoff                                                                                |
