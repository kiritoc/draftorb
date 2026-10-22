# PLAN SUMMARY

## Vision
A free tool that, given ANY partial draft (0 to 10 known champions, roles known or not), recommends the best champion for the user's slot plus runes; and in game recommends item purchases depending on game state (ahead/behind) and who is fed.

Inspirations: coachkarakal.com/drafting (support picks by synergy/counter with levels 1-3, blind-pick mode, gameplan) and coachless.gg (stat-driven builds/runes, WPA = win probability added).
Our approach = **hybrid**: stats-driven engine + thin manual layer (champion tags, item tags, gameplan notes).

## Scope
**Phase 1 (MVP):** Support role, Diamond rank, one region (EUW), current patch.
**Later:** other roles, other ranks (config-driven), more regions.

## Constraints
- 100% free (no paid API/LLM/hosting). Riot API only (free key).
- TypeScript everywhere; Windows with minimal setup (Node + pnpm).
- Vibe-coded with several different AIs -> docs-driven workflow (`docs/WORKFLOW.md`).
- Static site + precomputed JSON; scoring runs client-side.

## Key product decisions
- Rank logic: **draft probabilities** use games near the player's rank (kernel around Diamond). **Runes/items** use the player's rank and above up to Challenger (experts), with experience filters. See SPECS §3.
- Partial info: role inference with probabilities; unknown roles handled by weighted assignment. See SPECS §4.
- Auto-detection: Live Client Data API + LCU first (desktop); image recognition is plan B. See SPECS §9.

## Roadmap (epics)
| Epic | Content | Milestone |
|---|---|---|
| E0 Foundations | monorepo, types, Data Dragon, champion tags | M0 |
| E1 ETL | Riot client, SQLite, ingestion, aggregation, JSON export | M1 |
| E2 Engine | rank weighting, role inference, scoring, blind pick, golden tests | M2 |
| E3 Web MVP | draft screen, recommendations, deploy | **M3 = MVP** |
| E4 Runes | rune recommendation + gameplan notes | M4 |
| E5 Items | item catalog/tags, threat score, recommender | M5 |
| E6 Live | LCU + Live Client API, Electron overlay | M6 |
| E7 Vision | capture, portraits, OCR scoreboard, correction UI | M7 |

Run ETL collection in the background as early as possible (E1) — data volume is the main bottleneck.

## Risks
| Risk | Mitigation |
|---|---|
| Riot dev key limits / expiry (24h) | Resumable ingestion, rate limiter, apply for production key early |
| Not enough Diamond games for rare pairs | Bayesian shrinkage + manual tags as prior + show sample size |
| Expert (Master+) stats biased by one-tricks | Min games per player on champion; show pick share |
| Patch changes invalidate data | Patch-tagged data, recency decay, JSON manifest with patch |
| Riot policy on in-game advice tools | Read policy before E6/E7; log in DECISIONS.md |
| Vision robustness (resolution, UI scale, language) | Prefer LCU/Live API; correction UI; eval harness |
| AI drift between sessions | AGENTS.md rules, small tickets, tests, PROGRESS handoff |
