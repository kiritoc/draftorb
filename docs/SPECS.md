# SPECS

Status of this doc: v0.2 (ranking model D-020..D-023) — edit via `DECISIONS.md` when changing behavior. Sections tied to ADRs D-020..D-023 are normative only once those ADRs are accepted.

## 1. Users & use cases

- UC1 Draft: user (Diamond default) enters known champions (allies/enemies, roles optional) -> gets ranked champion picks for their slot with explanations. Phase 1: user is Support.
- UC2 Blind pick: no/few enemies known -> picks ranked by safety.
- UC3 Runes: after choosing, get best rune page for this context.
- UC4 Items in game: given game state -> next item(s) to buy, with reason.
- UC5 (later) Auto-fill draft/state from client or screen.
- UC6 Champion pool: the user keeps a personal pool of champions they play well and sees the best picks from that pool for the current draft AND the best picks overall (to learn a new champion), each list with a "Show more" button (D-024).

## 2. Inputs (Draft)

```
DraftInput {
  userRank: Rank            // default DIAMOND_IV..I -> bucket "DIAMOND"
  userRole: Role            // phase 1: SUPPORT
  allies: Slot[]            // up to 4 others
  enemies: Slot[]           // up to 5
  blindPick: boolean
  pool?: ChampionId[]       // pool of userRole (D-024): never changes scores, only fills poolRecommendations
}
Slot { championId: ChampionId, role?: Role }   // role optional
```

Any subset can be empty. Engine must never crash on missing info.

### 2.1 Champion pool (D-024)

- A per-role list of champion ids owned by the user, stored only in the browser (`localStorage` key `draftorb.pool.v1`, versioned envelope `{ version: 1, pools: { <ROLE>: ChampionId[] } }`, zod-validated). No account, no server. Max `poolMaxSize` (UI config, default 40) per role. Phase 1 exposes SUPPORT only; storage is role-keyed.
- Resilience: unavailable, full or corrupted storage gives an empty pool plus a visible notice, never a crash; ids absent from the current `champions.json` are dropped with a notice.
- Export/import as JSON text (validated before it replaces the stored pool), to back up or move devices.
- The pool never changes scores: `score(c)` is identical with or without a pool. It is not a boost and not a hard filter. Pool champions join the §5 candidate set, so `recommendations` may gain extra rows (and global ranks may shift) without reordering the original roleProb subsequence. See §7.1.

## 3. Rank logic

Rank buckets for weighting (distinct from persisted `rank_score` in DATA_MODEL.md): the 8 buckets are IRON=0, BRONZE=1, SILVER=2, GOLD=3, PLATINUM=4, EMERALD=5, DIAMOND=6, MASTER_PLUS=7 (where MASTER_PLUS merges MASTER, GRANDMASTER and CHALLENGER; config in `engine/config.ts`). Exports and `manifest.rankBuckets` use these 8 rank buckets, not the 10 raw rank tiers (IRON..CHALLENGER). Persisted player `rank_score` uses the accepted D-016 tier/division formula and is not an exact rank or a weighting bucket.

- **Draft probabilities** (pairs, matchups, baselines): weight per game `w = exp(-|gameRank - userRank| / tau)`, tau=1.25 (config). Never use data below userRank-2 tiers.
- **Runes & items**: use games with `gameRank >= userRank` (up to Challenger). Weight `w = min(1 + alpha*(gameRank-userRank), wMax)`, alpha=0.25, wMax=2.0. Only expert players (D-022): `champion_games >= minChampGames` (default 30) in our data, with the champion-mastery-v4 fallback applied only to participants of the user's role (`is_expert` flag). Show both winrate and pick share among those players.
- Optional UI toggle: "Master+ only".
- Recency: multiply by `decay^(currentPatchIndex - gamePatchIndex)` (decay=0.85).
- Patch window: ingestion keeps every patch >= `--since-patch` (D-017); recency is applied here, at aggregation time, never by dropping games at ingestion.
- Rank reliability: games with `matches.rank_known_count = 1` (only the seed player's rank is known, D-019) are multiplied by `unknownRankFactor` (default 0.5, config).
- Known limitation (D-004/D-021): draft baselines and pairs are not expert-filtered, so one-trick players can inflate some picks; T-027.a includes an optional ablation that down-weights games by `champion_games` to measure it.
- Effective sample size: every threshold on weighted counts (`minGames`, level `n >= 100`; `minChampGames` counts raw games and is unaffected) uses `n_eff = (sum w)^2 / sum w^2`, so a few heavily weighted games cannot pass a threshold. Aggregated tables store `games_w2 = sum w^2` for this.

## 4. Role inference (unknown roles)

- Table `roleProb[champion][role]` from data.
- If a slot has a role, it is fixed (prob 1).
- Otherwise assign roles within a team by maximizing sum of log roleProb under constraint "one champion per role" (Hungarian algorithm / brute force, 5! = 120 permutations is fine).
- Output also the **confidence** of each assignment (probability mass of the best assignment vs alternatives). Confidence scales how much that champion's synergy/counter terms count.
- UI lets the user override a role; override = confidence 1.

## 5. Scoring a candidate `c` for `myRole` (Phase 1: `myRole` = SUPPORT)

Candidate set: champions with `roleProb[c][myRole] >= 0.05`, plus every champion of the user pool (D-024). A pool champion below the threshold is still scored when it passes the baseline gate below and carries the warning `offRole`. The pool never changes any score.

All effects are combined on the log-odds scale (`logit(p) = ln(p / (1 - p))`, `sigmoid` = its inverse) and every context layer is shrunk toward the layer below it (D-021). Weighted counts are converted to _equivalent counts_ before shrinkage (weights are <= 1, so `k` is in raw-game units): `games_e = n_eff`, `wins_e = wins_w * n_eff / games_w`.

```
p0       = (wins_e + k0*0.5)/(games_e + k0)   // baseline winrate of c (rank/recency weighted, §3), shrunk toward 0.5, k0 = 20
x        = logit(p0)
pairSum  = sum over known slots s of                                        // layer 1: pairs
           conf(s) * influence[myRole][s.side][s.role][draft] * pairTerm(c, s)
           // slots processed by descending influence (ties by championId)
x       += s * pairSum                                      // s = global pair scale (config, default 1.0, fit by T-027.a)
if the enemy lane-group champions of laneGroup(myRole) are known:             // layer 2
  x += conf_lane * laneTerm(lane_vs[c, laneGroup(myRole).enemies], q = sigmoid(x))
if laneGroup(myRole).allies is non-empty and known:                           // layer 3 (skipped for 1v1 lane groups (TOP, MID, JUNGLE), where lane_full would duplicate lane_vs)
  x += conf_lane * laneTerm(lane_full[c, laneGroup(myRole).allies, laneGroup(myRole).enemies], q = sigmoid(x))
x += W_comp  * compNeed(c, allies, enemies)
x += W_blind * blindSafety(c)                               // only if blindPick or few enemies known
P(c) = sigmoid(x);  score(c) = P(c)
```

- `laneGroup(myRole)` (config, D-021): `SUPPORT`/`ADC` = the bot lane (me, ally lane partner, enemy support + enemy ADC); `TOP` = me vs enemy top; `MID` = me vs enemy mid; `JUNGLE` = me vs enemy jungle (1v1, `lane_full` skipped). A layer is skipped when one of its champions is unknown. `conf_lane` = product of the §4 confidences of the lane-group champions. Phase 1 populates only `myRole = SUPPORT`.
- Baseline gate: if the candidate's baseline `n_eff < minGames`, it gets no score and no rank: it goes to `insufficientData` (§7) with `nEff` and `rawGames` (golden rule 8), not to the ranked `recommendations`. The `k0` shrinkage only guards near-perfect records that already passed this gate.
- Every probability passed to `logit` is clamped to `[eps, 1 - eps]` (eps = 1e-4), so a perfect or empty record can never produce an infinite or NaN score.
- `pairTerm(c, s) = logit((wins_e + k*p0)/(games_e + k)) - logit(p0)`, k = prior strength (default 40 equivalent games). Pair terms are summed and correlated (several can describe the same matchups), so the global scale `s` absorbs systematic over-counting and is fit on the validation window (T-027.a).
- `laneTerm(t, q) = logit((t.wins_e + k_lane*q)/(t.games_e + k_lane)) - logit(q)`, k_lane default 40 equivalent games: an exact lane context is shrunk toward the prediction already made from the pairs, not toward the baseline. A `lane` reason is therefore a _correction_ to the pair estimate and may show a small deltaPp; UI phrasing: "in this exact lane, history suggests more/less than the pair terms imply".
- Low data: a term whose `n_eff < minGames` (default 25) is 0 and its reason is flagged `lowData`.
- Influence (`influence[myRole][side][otherRole][phase]`, D-020, `engine/config.ts`). Default values for the `draft` and `lane` phases (priors, recalibrated per role x phase by the D-023 backtest):

| myRole  | side  | TOP | JUNGLE | MID | ADC | SUPPORT |
| ------- | ----- | --- | ------ | --- | --- | ------- |
| SUPPORT | ally  | 0.2 | 0.6    | 0.3 | 1.0 | –       |
| SUPPORT | enemy | 0.1 | 0.4    | 0.2 | 0.9 | 1.0     |
| ADC     | ally  | 0.1 | 0.5    | 0.2 | –   | 1.0     |
| ADC     | enemy | 0.1 | 0.4    | 0.2 | 1.0 | 0.9     |
| JUNGLE  | ally  | 0.5 | –      | 0.6 | 0.4 | 0.5     |
| JUNGLE  | enemy | 0.4 | 1.0    | 0.6 | 0.3 | 0.4     |
| MID     | ally  | 0.2 | 0.7    | –   | 0.2 | 0.3     |
| MID     | enemy | 0.2 | 0.6    | 1.0 | 0.2 | 0.3     |
| TOP     | ally  | –   | 0.6    | 0.2 | 0.1 | 0.1     |
| TOP     | enemy | 1.0 | 0.6    | 0.2 | 0.1 | 0.1     |

Rationale per row: support — bot lane (ally ADC, enemy support + ADC) first, then junglers, then mid, then top; top — the mirror (direct opponent first, then jungle, mid, bot); ADC — ally support and the enemy bot lane; mid — the enemy mid, then both junglers; jungle — the enemy jungle first, then mid, then top/support, then ADC. The enemy same-role cell (direct lane opponent) is the row maximum.
Validation (T-020): every cell defined and in [0, 1]; the opponent cell is the row max; the table is validated by zod; a unit test fails on an incomplete row.
`mid` phase (items only, §8.2), every role: enemy weight = `lambda * lane + (1 - lambda) * threatShare(e) * enemiesKnown`, lambda = 0.3; ally weights = the `lane` row. `draft` and `lane` rows share the defaults today and may diverge later; each role x phase is calibrated separately. Phase 1 uses only the SUPPORT rows; the other rows exist so later roles only need data, not code.

- Reported deltas: each reason's `deltaPp = 100 * (sigmoid(x_before + term) - sigmoid(x_before))`, in the order the terms are added (pairs by descending influence, then `lane_vs`, `lane_full`, comp, blind); the total delta is `100 * (P(c) - p0)`.
- **Levels 1-3** (like Karakal): from a reason's `deltaPp` — L1 >= +1.0pp, L2 >= +2.5pp, L3 >= +4.5pp (needs `n_eff >= 100`). Negative symmetric (counter-picked). Show badge in UI.
- `compNeed`: from champion tags (see 6): reward filling missing needs (e.g. team has no engage, damage all AD...). Small weight in log-odds units, explained in UI.
- `blindSafety(c)`: expected term against the distribution of likely enemy lane opponents weighted by pick rate: `sum_e pickShare(e) * pairTerm(c, e)`, plus penalty for worst-case matchup (min term). Used when blindPick = true or fewer than 2 lane enemies known.
- Validation (D-023/T-027.a): every parameter in this section is a prior until a backtest passes — frozen temporal holdout, rolling validation for tuning, paired-bootstrap gate on log-loss vs the baseline-only model.

## 6. Manual data (tags)

`data/manual/champion-tags.json` (validated by zod): per champion: `damageType` (AP/AD/mixed/none), `archetype` (enchanter/engage/poke/catch/tank/...), booleans `hardEngage`, `peel`, `poke`, `waveclear`, `scaling` (early/mid/late), `range`, `ccCount`. Used for compNeed, cold-start priors, and explanations.
`data/manual/gameplans/<champion>.md`: optional short gameplan (level 1, matchup tips, roams, vision). Shown after pick. Optional.

## 7. Output

```
Recommendation {
  championId, score, rank,       // rank = overall rank (global), also inside poolRecommendations
  poolRank?: number              // rank inside the user's pool (D-024); only set in poolRecommendations
  reasons: Reason[]    // {type:'synergy'|'counter'|'lane'|'comp'|'blind', with: ChampionId[]?, level:1|2|3|-1|-2|-3, deltaPp, n, lowData}
  reliability: { games: number, lowData: boolean }
  warnings: string[]   // e.g. "countered by enemy support X", "offRole" (pool champion rarely played in this role)
}
DraftResult {
  recommendations: Recommendation[]                    // overall ranking: ALL scored candidates, never truncated by the engine (D-024)
  insufficientData: { championId, nEff: number, rawGames: number }[]  // baseline n_eff < minGames (§5), unscored
  poolRecommendations?: Recommendation[]               // only when input.pool is non-empty: scored pool champions in overall order (`rank` = overall rank, `poolRank` = rank in the pool)
  poolUnavailable?: { championId, reason: 'insufficientData' | 'unknownChampion' }[]  // pool champions without a score (numbers live in insufficientData)
}
```

Sorted desc. Always show why + sample sizes. Never show a % without sample size. A `Reason.n` and `Recommendation.reliability.games` carry the **effective sample size** `n_eff = (sum w)^2 / sum w^2` (a real number, not a raw game count), because every threshold and `lowData` flag in §5/§7 is evaluated against `n_eff`; `DraftResult.insufficientData` separately exposes `nEff` and `rawGames` for champions that fail the baseline gate. Reason type `lane`, `DraftResult.insufficientData` and the pool fields (`poolRank`, `poolRecommendations`, `poolUnavailable`) are added to the shared schemas by T-002.b.

## 7.1 Recommendation lists (D-024)

- Two lists, one card component: **From your pool** (`poolRecommendations`, shown first when the pool is non-empty; with an empty pool a one-line call to action to add champions) and **Best overall** (`recommendations`, always shown, even with an empty pool).
- Both lists are the engine's complete output, sliced client-side: the first `recommendationPageSize` items (default 5, `apps/web/src/config.ts`), then a "Show N more" button reveals the next N (N = page size) each time until the list is exhausted. A "Showing X of Y" label is always visible and the button disappears when nothing remains. The two lists are paginated independently.
- The overall list also contains pool champions, tagged "In your pool". A UI-only toggle "Hide my pool" (default off) lets the user focus on champions to learn. Ranks always stay global, so gaps are expected when the toggle is on.
- Pool cards show both ranks ("#2 in your pool · #14 overall"). Pool champions without a score are listed after the ranked ones with the reason and sample size ("not enough data (n_eff 12)"); they are never hidden.
- Visible counts reset to the page size when the draft input changes (and the pool list when the pool changes). The "Show more" control is a real `<button>`, keyboard reachable, and the count label is an `aria-live="polite"` region.
- Determinism: the same draft input gives the same lists in the same order. The pool never changes `score(c)` or reasons. Pool-only candidates can appear in `recommendations` (SPECS §5), which may insert extra rows and shift global `rank` numbers; the relative order of champions that were already in the roleProb set stays the same. `poolRecommendations` is the subsequence of scored pool champions.

## 8. Runes & Items

### 8.1 Runes (UC3)

For chosen champion and context: aggregated rune pages from experts (§3 experts rule, experts defined in D-022). Context slots are the top `contextSlots` (config, default 3) champions of the lane context, ordered by `influence[myRole][*][*][lane]` (D-020) — for a support: ally ADC + enemy support + enemy ADC; nothing is hardcoded to the bot lane. Selection: the `contextSlots` slots with the highest lane-phase influence, ranked descending (ties by side, ally before enemy, then role order TOP, JUNGLE, MID, ADC, SUPPORT). Contexts use the D-021 back-off chain, most specific first, dropping the _least_-influential selected slot at each step — so the strongest matchup signal survives longest: the `contextSlots` lane slots -> enemy damage mix -> champion global. Each page's win rate is shrunk toward the same page's win rate in the next broader context. Rank by shrunk winrate, tie-break by pick share. Return top 3 pages + adaptation hints (shard choice by enemy damage mix). Never show a page win rate without its sample size.

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
5. Phase (one rule everywhere, D-020/D-022): `lane` = starting items (k = 0) and completed item k = 1 bought before `laneEndSeconds` (840 s, config); `mid` otherwise.
6. Item scoring v1 (rules): `base(item) + profileFit(item) + stateFit(item, bucket) + counterFed(item, fedEnemy)` using item tags (`data/manual/item-tags.json`).
7. Item scoring v2 (data, D-022): compare like for like — context = (champion, slot `k` with 0 = starting items, purchase time bucket of 5 min, state bucket at purchase, enemy profile bucket `AD|AP|mixed`, and in the `lane` phase the lane-context slots — top `contextSlots` by lane-phase influence, §8.1). Score = shrunk win rate of the item minus the average shrunk win rate of all items bought in that context; back-off order when data is low: lane champions -> enemy profile -> state -> time bucket -> (champion, k). Replaces the rule score only where `n_eff >= minGames`. Observational: phrased as "players who bought X here won Y %", never as cause.
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
- Accessible UI, keyboard champion search; the pool editor and the "Show more" buttons are keyboard accessible.
- The pool stays in the browser (never sent anywhere).
- Show current patch + data freshness.

## 11. Out of scope (Phase 1)

Non-support roles, accounts/login, pool sync across devices or auto-import of the pool from a Riot account, server-side code, paid anything, mobile app, replays. The engine and data model are role-generic (D-020/D-021); only the SUPPORT role is populated and exposed in Phase 1.
