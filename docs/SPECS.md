# SPECS

Status of this doc: v0.1 — edit via `DECISIONS.md` when changing behavior.

## 1. Users & use cases
- UC1 Draft: user (Diamond default) enters known champions (allies/enemies, roles optional) -> gets ranked champion picks for their slot with explanations. Phase 1: user is Support.
- UC2 Blind pick: no/few enemies known -> picks ranked by safety.
- UC3 Runes: after choosing, get best rune page for this context.
- UC4 Items in game: given game state -> next item(s) to buy, with reason.
- UC5 (later) Auto-fill draft/state from client or screen.

## 2. Inputs (Draft)
```
DraftInput {
  userRank: Rank            // default DIAMOND_IV..I -> bucket "DIAMOND"
  userRole: Role            // phase 1: SUPPORT
  allies: Slot[]            // up to 4 others
  enemies: Slot[]           // up to 5
  blindPick: boolean
  pool?: ChampionId[]       // optional filter
}
Slot { championId: ChampionId, role?: Role }   // role optional
```
Any subset can be empty. Engine must never crash on missing info.

## 3. Rank logic
Rank buckets for weighting (distinct from persisted `rank_score` in DATA_MODEL.md): IRON=0, BRONZE=1, SILVER=2, GOLD=3, PLATINUM=4, EMERALD=5, DIAMOND=6, MASTER+(M/GM/C)=7 (config in `engine/config.ts`). Persisted player `rank_score` uses the accepted D-016 tier/division formula and is not an exact rank or a weighting bucket.
- **Draft probabilities** (pairs, matchups, baselines): weight per game `w = exp(-|gameRank - userRank| / tau)`, tau=1.25 (config). Never use data below userRank-2 tiers.
- **Runes & items**: use games with `gameRank >= userRank` (up to Challenger). Weight `w = min(1 + alpha*(gameRank-userRank), wMax)`, alpha=0.25, wMax=2.0. Only players with `championGames >= minChampGames` (default 30 on that champ). Show both winrate and pick share among those players.
- Optional UI toggle: "Master+ only".
- Recency: multiply by `decay^(currentPatchIndex - gamePatchIndex)` (decay=0.85).

## 4. Role inference (unknown roles)
- Table `roleProb[champion][role]` from data.
- If a slot has a role, it is fixed (prob 1).
- Otherwise assign roles within a team by maximizing sum of log roleProb under constraint "one champion per role" (Hungarian algorithm / brute force, 5! = 120 permutations is fine).
- Output also the **confidence** of each assignment (probability mass of the best assignment vs alternatives). Confidence scales how much that champion's synergy/counter terms count.
- UI lets the user override a role; override = confidence 1.

## 5. Scoring a candidate support `c` (Phase 1)
Candidate set: champions with `roleProb[c][SUPPORT] >= 0.05` (or user pool).
```
score(c) = W_base  * baseDelta(c)
         + W_ally  * sum_{a in allies}  conf(a) * roleWeightAlly(a.role)  * synergyDelta(c, a)
         + W_enemy * sum_{e in enemies} conf(e) * roleWeightEnemy(e.role) * counterDelta(c, e)
         + W_comp  * compNeed(c, allies, enemies)
         + W_blind * blindSafety(c)         // only if blindPick or few enemies known
```
- `delta` = shrunk winrate difference vs the candidate's baseline, in percentage points:
  `delta = (wins + k*p0)/(n + k) - p0` computed with weighted counts, where p0 = baseline winrate of the candidate (or of the pair type), k=prior strength (default 40 games). If `n < minGames` (default 25) -> delta = 0 and flag `lowData`.
- Default weights: roleWeightAlly: ADC 1.0, JUNGLE 0.6, MID 0.3, TOP 0.2. roleWeightEnemy: SUPPORT 1.0, ADC 0.9, JUNGLE 0.4, MID 0.2, TOP 0.1. All in config, tunable.
- **Levels 1-3** (like Karakal): from `delta` — L1 >= +1.0pp, L2 >= +2.5pp, L3 >= +4.5pp (needs n >= 100). Negative symmetric (counter-picked). Show badge in UI.
- `compNeed`: from champion tags (see 6): reward filling missing needs (e.g. team has no engage, damage all AD...). Small weight, explained in UI.
- `blindSafety(c)`: expected delta against the distribution of likely enemy supports/ADCs weighted by pick rate: `sum_e pickShare(e) * counterDelta(c,e)`, plus penalty for worst-case matchup (min delta). Used when blindPick = true or fewer than 2 lane enemies known.

## 6. Manual data (tags)
`data/manual/champion-tags.json` (validated by zod): per champion: `damageType` (AP/AD/mixed/none), `archetype` (enchanter/engage/poke/catch/tank/...), booleans `hardEngage`, `peel`, `poke`, `waveclear`, `scaling` (early/mid/late), `range`, `ccCount`. Used for compNeed, cold-start priors, and explanations.
`data/manual/gameplans/<champion>.md`: optional short gameplan (level 1, matchup tips, roams, vision). Shown after pick. Optional.

## 7. Output
```
Recommendation {
  championId, score, rank,
  reasons: Reason[]    // {type:'synergy'|'counter'|'comp'|'blind', with: ChampionId?, level:1|2|3|-1|-2|-3, deltaPp, n}
  reliability: { games: number, lowData: boolean }
  warnings: string[]   // e.g. "countered by enemy support X"
}
```
Sorted desc. Always show why + sample sizes. Never show a % without sample size.

## 8. Runes & Items

### 8.1 Runes (UC3)
For chosen champion and context (enemy damage mix, enemy support/ADC, ally ADC): aggregated rune pages with weights from §3 (experts rule). Rank by shrunk winrate, tie-break by pick share. Return top 3 pages + adaptation hints (shard choice by enemy damage mix). Contextual aggregation falls back to the global page when the context has too little data.

### 8.2 Items (UC4)
```
GameState {
  time: seconds, me: PlayerState, allies: PlayerState[], enemies: PlayerState[],
  goldDiff?: number (team), kills/towers/dragons optional
}
PlayerState { championId, kills, deaths, assists, cs?, items: ItemId[], level? }
```
Steps:
1. Base build for the champion (stats, §3 experts rule).
2. **Threat score** per enemy: `threat = a*(K+0.5*A)/(D+1) + b*itemGold/avgItemGold(time) + c*scalingFactor(champion)` ; the top threat(s) = "fed". Params in config.
3. Enemy profile: damage mix (AP/AD), CC density, healing/shielding, burst vs sustained, weighted by each enemy's threat.
4. Game state bucket: `ahead` / `even` / `behind` from goldDiff & kills (config thresholds).
5. Item scoring: `base(item) + profileFit(item) + stateFit(item, bucket) + counterFed(item, fedEnemy)` using item tags (`data/manual/item-tags.json`). v2: replace rules with context winrates learned from timelines.
6. Output next 1-3 items with reasons ("enemy X is fed, AD heavy -> armor"), and what to skip.

## 9. Auto-detection (Phase 2 / Epic E6-E7)
Order of preference:
1. **LCU** (League client local API): champ select session -> fills draft.
2. **Live Client Data API** (`https://127.0.0.1:2999/liveclientdata/allgamedata`): scores, items, champions of all players during game. (Gold not exposed; estimate from items.)
3. **Image recognition** (fallback): capture screen -> portraits (template matching/embeddings vs Data Dragon icons), scoreboard: items (template matching) + K/D/A/CS (OCR). Always followed by a **correction UI**. No memory reading, no input injection.
Read Riot's third-party policy before shipping E6/E7; log result in DECISIONS.md.

## 10. Non-functional
- Engine call < 50 ms for a full draft on a mid laptop.
- Static hosting, JSON data files < 5 MB each (gzip), lazy loaded.
- Works offline after first load (nice-to-have).
- Accessible UI, keyboard champion search.
- Show current patch + data freshness.

## 11. Out of scope (Phase 1)
Non-support roles, accounts/login, server-side code, paid anything, mobile app, replays.
