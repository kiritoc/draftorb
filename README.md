# DraftOrb

Free League of Legends draft & itemization assistant. Phase 1: **Support / Diamond**.

- Draft: recommends a champion (and runes) from any partial draft (blind pick, unknown roles).
- In-game: recommends items based on game state (winning/losing) and who is fed.
- Later: auto-detection of the draft and scoreboard (Live Client API / LCU first, image recognition as fallback).

## Docs index

| File                   | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `AGENTS.md`            | Instructions for any AI (start here)              |
| `docs/PLAN_SUMMARY.md` | Vision, scope, roadmap, risks                     |
| `docs/SPECS.md`        | Functional + algorithm specs                      |
| `docs/ARCHITECTURE.md` | Stack, modules, data flow                         |
| `docs/DATA_MODEL.md`   | SQLite schema + exported JSON formats             |
| `docs/RIOT_API.md`     | Riot API usage, limits, ToS notes                 |
| `docs/TICKETS.md`      | Backlog (one ticket per session)                  |
| `docs/PROGRESS.md`     | Current status + session handoffs                 |
| `docs/BUGS.md`         | Bug tracker                                       |
| `docs/WORKFLOW.md`     | How to work, multi-AI handoff, definition of done |
| `docs/CONVENTIONS.md`  | Code style and naming                             |
| `docs/TESTING.md`      | Test strategy and golden cases                    |
| `docs/DECISIONS.md`    | Decision log (ADR)                                |
| `docs/GLOSSARY.md`     | Domain vocabulary                                 |
| `docs/SETUP.md`        | Windows setup                                     |
| `docs/PROMPTS.md`      | Ready-to-paste prompts for AI sessions            |

Not affiliated with Riot Games.
