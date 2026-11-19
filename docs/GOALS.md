# GOALS

Status: approved by the owner on 2026-11-15 (goal interview). This is the single short source of truth for _what_ we build. DECISIONS.md explains _why_; SPECS.md explains _how_. A pull request that conflicts with this file needs an owner-approved decision first.

## Purpose

A personal, fast companion for one player (KiriToc, Diamond, EUW) that runs next to the game on Windows 11 and answers three questions:

1. **Champion select:** given my locked allies and enemies, which champion should I pick, and is there a better one than my usual?
2. **After I lock in:** which runes, summoner spells and starting items?
3. **In game:** which item next, depending on whether I am winning, losing or even, who is fed, and what I should sell?

The code can be shared. The data (profile, pool) is tied to one player.

## The player

- About 70% Support, 29.5% Top and Jungle (autofilled often), 0.5% ADC and Mid.
- Plays a personal pool of champions (for example Shen everywhere, Teemo Top/Jungle, Maokai Jungle/Top/Support, Nami Support) and wants to _see_ when a better pick exists, not be forced into it.
- Allies' roles are known in champ select. Enemy roles are guessed.

## Core flows

- **Pick screen:** enter locked allies, enemies (no role needed) and bans. The tool infers enemy roles with a confidence the player can override. Shows "From your pool" above "Best overall"; pool champions are tagged in both lists. Champion portraits next to names.
- **Setup screen:** runes and summoners in two modes the player can switch live: _top players_ (experts, high rank, fresh patches) or _my data_. Starting items included.
- **Game screen:** after the game starts, data is read from the game client automatically (closable at any time). Item advice for win / lose / even, a "fed" option for enemies or allies, and sell advice. Only the player's own champion is mandatory; any missing field shows a warning border and can be filled later.

## Scope by version

| Version | Contents                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1      | Pick screen for Support, Top, Jungle (ADC and Mid minimal). Per-role pool editor (champion x roles). Manual draft and bans input. "Unvalidated model" label. Personal record shown as a badge only. Light/dark toggle. |
| v2      | Runes, summoners and starters (top players / my data). Blended "my results" ranking.                                                                                                                                   |
| v3      | In-game items with automatic game-client data (LCU and Live Client API). Sell advice, fed enemy/ally option.                                                                                                           |
| Later   | Per-rune usefulness for the player ("is Grasp useless for me?"), hand-written counter notes, screenshot import as a fallback only.                                                                                     |

## Principles

- **Honest numbers:** every figure shows its sample size. Thin data falls back to a broader statistic (picks, runes) or a clearly labeled rule (items). Never invent a number.
- **Evidence, not habit:** experts only, with a per-player cap and a minimum number of distinct players; win rate and pick share are shown separately.
- **Pool never changes scores:** it highlights and groups.
- **Prove before trusting:** the draft ranking carries an "unvalidated" label until the offline backtest passes (D-023).
- **Fast:** starts in seconds, light on resources, data downloaded at launch.
- **No paid services, no runtime AI** (D-006).

## Non-goals

- A public website or accounts for other users.
- Screenshot recognition as the main input.
- Tuning ADC and Mid beyond champion-level statistics.
- Anything that needs a paid service.

## Platform and look

Windows 11 desktop program: TypeScript engine with a Tauri shell (D-115, pending the Windows spike). Visual direction C from the style canvas: light, clean, large targets, with a dark mode toggle that remembers the last choice (first launch follows the Windows theme).

## Working rules

- Restart the engine and app from this goal; keep the database and the data pipeline (D-003, D-094).
- No decision marked PROPOSED is implemented before the owner approves it.
- Review pull requests against this file and the accepted decisions.

## Open items

- Riot policy on in-game advice tools (first ticket of the live phase).

Resolved: language = TypeScript engine with a Tauri shell, pending the Windows spike (D-115); shared aggregates published as a public release asset with no token, profile data private (D-111); champion pool versioned in the repo as `data/pool.config.json` (D-114); patch labels: both shown, 16.N ↔ 26.N verified (D-117).
