# SPECS

Status of this doc: v0.2 (ranking model D-020..D-023) — edit via `DECISIONS.md` when changing behavior.

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
- Patch window: ingestion keeps every patch >= `--since-patch` (D-017); recency is applied here, at aggregation time, never by dropping games at ingestion.
- Rank reliability: games with `matches.rank_known_count = 0` (rank taken from the seed player only, D-019) are multiplied by `unknownRankFactor` (default 0.5, config).
- Effective sample size: every threshold on weighted counts (`minGames`, level `n >= 100`; `minChampGames` counts raw games and is unaffected) uses `n_eff = (sum w)^2 / sum w^2`, so a few heavily weighted games cannot pass a threshold. Aggregated tables store `games_w2 = sum w^2` for this.

## 4. Role inference (unknown roles)
- Table `roleProb[champion][role]` from data.
- If a slot has a role, it is fixed (prob 1).
- Otherwise assign roles within a team by maximizing sum of log roleProb under constraint "one champion per role" (Hungarian algorithm / brute force, 5! = 120 permutations is fine).
- Output also the **confidence** of each assignment (probability mass of the best assignment vs alternatives). Confidence scales how much that champion's synergy/counter terms count.
- UI lets the user override a role; override = confidence 1.

## 5. Scoring a candidate support `c` (Phase 1)
Candidate set: champions with `roleProb[c][SUPPORT] >= 0.05` (or user pool).

All effects are combined on the log-odds scale (`logit(p) = ln(p / (1 - p))`, `sigmoid` = its inverse) and every context layer is shrunk toward the layer below it (D-021):
```
p0       = baseline winrate of c (rank/recency weighted, §3)
x        = logit(p0)
for each known slot s (ally or enemy, any role):            // layer 1: pairs
  x += conf(s) * influence[SUPPORT][s.side][s.role][draft] * pairTerm(c, s)
if enemy support and enemy ADC known:                       // layer 2: enemy bot lane
  x += conf_lane * laneTerm(lane_vs[c, enemySup, enemyAdc], q = sigmoid(x))
if ally ADC also known:                                     // layer 3: full bot lane
  x += conf_lane * laneTerm(lane_2v2[c, allyAdc, enemySup, enemyAdc], q = sigmoid(x))
x += W_comp  * compNeed(c, allies, enemies)
x += W_blind * blindSafety(c)                               // only if blindPick or few enemies known
P(c) = sigmoid(x);  score(c) = P(c)
```
- `pairTerm(c, s) = logit((wins_w + k*p0)/(games_w + k)) - logit(p0)`, k = prior strength (default 40 games).
- `laneTerm(t, q) = logit((t.wins_w + k_lane*q)/(t.games_w + k_lane)) - logit(q)`, k_lane default 40: an exact lane context is shrunk toward the prediction already made from the pairs, not toward the baseline, so it only moves the score when it has enough games to disagree with the pairs.
- `conf_lane` = product of the §4 confidences of the lane champions involved.
- Low data: a term whose `n_eff < minGames` (default 25) is 0 and its reason is flagged `lowData`.
- Influence (`influence[myRole][side][otherRole][phase]`, D-020, `engine/config.ts`). Default values for the `draft` and `lane` phases (priors, recalibrated by the D-023 backtest):

| myRole | side | TOP | JUNGLE | MID | ADC | SUPPORT |
|---|---|---|---|---|---|---|
| SUPPORT | ally | 0.2 | 0.6 | 0.3 | 1.0 | – |
| SUPPORT | enemy | 0.1 | 0.4 | 0.2 | 0.9 | 1.0 |
| ADC | ally | 0.1 | 0.5 | 0.2 | – | 1.0 |
| ADC | enemy | 0.1 | 0.4 | 0.2 | 1.0 | 0.9 |
| JUNGLE | ally | 0.5 | – | 0.6 | 0.4 | 0.5 |
| JUNGLE | enemy | 0.4 | 1.0 | 0.6 | 0.3 | 0.4 |
| MID | ally | 0.2 | 0.7 | – | 0.2 | 0.3 |
| MID | enemy | 0.2 | 0.6 | 1.0 | 0.2 | 0.3 |
| TOP | ally | – | 0.6 | 0.2 | 0.1 | 0.1 |
| TOP | enemy | 1.0 | 0.6 | 0.2 | 0.1 | 0.1 |

  `mid` phase (items only, §8.2): enemy weight = `lambda * lane + (1 - lambda) * threatShare(e) * enemiesKnown`, lambda = 0.3; ally weights = `lane` row. Phase 1 uses only the SUPPORT rows; the other rows exist so later roles only need data, not code.
- Reported deltas: each reason's `deltaPp = 100 * (sigmoid(x_before + term) - sigmoid(x_before))`, in the order the terms are added; the total delta is `100 * (P(c) - p0)`.
- **Levels 1-3** (like Karakal): from a reason's `deltaPp` — L1 >= +1.0pp, L2 >= +2.5pp, L3 >= +4.5pp (needs `n_eff >= 100`). Negative symmetric (counter-picked). Show badge in UI.
- `compNeed`: from champion tags (see 6): reward filling missing needs (e.g. team has no engage, damage all AD...). Small weight in log-odds units, explained in UI.
- `blindSafety(c)`: expected term against the distribution of likely enemy supports/ADCs weighted by pick rate: `sum_e pickShare(e) * pairTerm(c, e)`, plus penalty for worst-case matchup (min term). Used when blindPick = true or fewer than 2 lane enemies known.

## 6. Manual data (tags)
`data/manual/champion-tags.json` (validated by zod): per champion: `damageType` (AP/AD/mixed/none), `archetype` (enchanter/engage/poke/catch/tank/...), booleans `hardEngage`, `peel`, `poke`, `waveclear`, `scaling` (early/mid/late), `range`, `ccCount`. Used for compNeed, cold-start priors, and explanations.
`data/manual/gameplans/<champion>.md`: optional short gameplan (level 1, matchup tips, roams, vision). Shown after pick. Optional.

## 7. Output
```
Recommendation {
  championId, score, rank,
  reasons: Reason[]    // {type:'synergy'|'counter'|'lane'|'comp'|'blind', with: ChampionId[]?, level:1|2|3|-1|-2|-3, deltaPp, n, lowData}
  reliability: { games: number, lowData: boolean }
  warnings: string[]   // e.g. "countered by enemy support X"
}
```
Sorted desc. Always show why + sample sizes. Never show a % without sample size.

## 8. Runes & Items

### 8.1 Runes (UC3)
For chosen champion and context: aggregated rune pages from experts (§3 experts rule, experts defined in D-022). Contexts use the D-021 back-off chain, most specific first: enemy bot lane + ally ADC -> enemy bot lane -> enemy damage mix -> champion global; slots are ordered by `influence[myRole][*][*][lane]` (D-020). Each page's win rate is shrunk toward the same page's win rate in the next broader context. Rank by shrunk winrate, tie-break by pick share. Return top 3 pages + adaptation hints (shard choice by enemy damage mix). Never show a page win rate without its sample size.

### 8.2 Items (UC4)
```
GameState {
  time: seconds, me: PlayerState, allies: PlayerState[], enemies: PlayerState[],
  goldDiff?: number (team), kills/towers/dragons optional
}
PlayerState { championId, kills, deaths, assists, cs?, items: ItemId[], level? }
```
Steps:
1. Base build for the champion (stats, §3 experts rule), per completed-item slot `k`.
2. **Threat score** per enemy: `threat = a*(K+0.5*A)/(D+1) + b*itemGold/avgItemGold(time) + c*scalingFactor(champion)` ; the top threat(s) = "fed". `threatShare(e) = threat(e) / sum threat`. Params in config.
3. Enemy profile: damage mix (AP/AD), CC density, healing/shielding, burst vs sustained, weighted by each enemy's `mid`-phase influence (D-020: lane weight blended with threat share).
4. Game state bucket: `ahead` / `even` / `behind` from goldDiff & kills (config thresholds).
5. Phase: `lane` for starting items and the first completed item while `time < laneEndSeconds` (840 s); `mid` otherwise.
6. Item scoring v1 (rules): `base(item) + profileFit(item) + stateFit(item, bucket) + counterFed(item, fedEnemy)` using item tags (`data/manual/item-tags.json`).
7. Item scoring v2 (data, D-022): compare like for like — context = (champion, slot `k`, purchase time bucket of 5 min, state bucket at purchase, enemy profile bucket `AD|AP|mixed`, and in the `lane` phase the enemy bot lane + ally ADC). Score = shrunk win rate of the item minus the average shrunk win rate of all items bought in that context; back-off order when data is low: lane champions -> enemy profile -> state -> time bucket -> (champion, k). Replaces the rule score only where `n_eff >= minGames`. Observational: phrased as "players who bought X here won Y %", never as cause.
8. Output next 1-3 items with reasons ("enemy X is fed, AD heavy -> armor"), sample size, and what to skip.

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
