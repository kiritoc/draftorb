# SPECS

Status of this doc: v0.2 (ranking model D-020..D-023) — edit via `DECISIONS.md` when changing behavior.

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
- Recency: multiply by `decay^(currentPatchIndex - gamePatchIndex)` (decay=0.85). Indices come from the `patches` table (SPECS §12, T-019.b/D-043): gaps in collected patches count as real patch distance.
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
- If inference fails for a team, the engine keeps the largest greedily built resolvable subset (fixed slots first). If that fails too, only fixed slots are kept, and a fixed role used by two or more slots of the same team is dropped as ambiguous (D-030). Dropped slots lose only role-dependent effects (pairs, lane); they stay excluded from candidates and still count for comp.
- The user's own role is reserved on the user's team: allies are never assigned `userRole`. An ally fixed to `userRole` is dropped from role-dependent layers (pairs, lane) but still counts for comp and stays excluded from candidates (D-050).

## 5. Scoring a candidate `c` for `myRole` (Phase 1: `myRole` = SUPPORT)

Candidate set: champions with `roleProb[c][myRole] >= roleProbThreshold` (config `RecommendConfig.roleProbThreshold`, default 0.05), plus every champion of the user pool (D-024). A pool champion below the threshold is still scored when it passes the baseline gate below and carries the warning `offRole`. The pool never changes any score.

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
x += W_blind * blindSafety(c)                               // only if blindPick or any lane-group enemy role is unknown; scores unseen roles only (0 when the lane is fully known)
P(c) = sigmoid(x);  score(c) = P(c)
```

- `laneGroup(myRole)` (config, D-021): `SUPPORT`/`ADC` = the bot lane (me, ally lane partner, enemy support + enemy ADC); `TOP` = me vs enemy top; `MID` = me vs enemy mid; `JUNGLE` = me vs enemy jungle (1v1, `lane_full` skipped). A layer is skipped when one of its champions is unknown. `conf_lane` = product of the §4 confidences of the lane-group champions of that layer: enemies only for `lane_vs`, allies and enemies for `lane_full` (D-030). The engine is role-generic; Phase 1 data populates only `myRole = SUPPORT`, so other roles get lane layers only once T-017 exports their `lane_vs`/`lane_full` rows.
- Baseline gate: if the candidate's baseline `n_eff < minGames`, it gets no score and no rank: it goes to `insufficientData` (§7) with `nEff` and, when known, `rawGames` (golden rule 8; a 0 or missing raw count is treated as unknown and omitted, B-025), not to the ranked `recommendations`. The `k0` shrinkage only guards near-perfect records that already passed this gate.
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
- **Levels 1-3** (like Karakal): from a reason's `deltaPp` — L1 >= +1.0pp, L2 >= +2.5pp, L3 >= +4.5pp. Positive L2/L3 need `n_eff >= highLevelMinGames` (config, default 100, validated `>= minGames`; a prior like every other parameter here); below that, a qualifying positive delta falls back to L1. Negative symmetric (counter-picked), without the `highLevelMinGames` gate. A lowData reason (`n_eff < minGames`) has level 0 for both signs. Show badge in UI.
- `compNeed`: from champion tags (see 6): reward filling missing needs (e.g. team has no engage, damage all AD...). Small weight in log-odds units, explained in UI. Only tagged board allies count as evidence (including allies whose role could not be inferred); with no tagged ally no need is reported. Enemies are ignored until T-025.
- `blindSafety(c)`: expected term against the distribution of likely _unseen_ enemy lane opponents weighted by pick rate: `sum_e pickShare(e) * pairTerm(c, e)`, plus penalty for worst-case matchup (`blindWorstCaseFactor * min(0, min term)`: a penalty only, never a bonus when every matchup is favorable), both per unseen lane-group role and summed. Known enemies are excluded (the pair layer scores them); missing or lowData matchups count as neutral (term 0) with their full share. Used when blindPick = true or any role of `laneGroup(myRole).enemies` is unknown. `pickShare(e)` is the per-role pick share from `pick-rate.json` (D-052), counting only champions with share `>= blindOpponentMinShare` (config, default 0.05, independent of `roleProbThreshold`). Until a pick-rate export is loaded (legacy exports), `pickShare(e)` falls back to the normalized `roleProb[e][role]` approximation (B-026).
- Comp and blind reasons have no sample (`n = 0`, never lowData): their level comes from `deltaPp` alone, positive levels capped at L1, negative levels unrestricted.
- Hard-counter warning (code `counteredBy:<ROLE>:<championId>`, rendered by the web `strings` module): when the layer-1 `counter` reason `deltaPp` of a known, non-lowData enemy pair is `<= hardCounterDeltaPp` (config, default -4.5; D-030). The comparison uses the deltaPp rounded to `DELTA_PP_DECIMALS` (the value shown in the reason), so a raw -4.497 (shown -4.5) warns.
- Validation (D-023/T-027.a): every parameter in this section is a prior until a backtest passes — frozen temporal holdout, rolling validation for tuning, paired-bootstrap gate on log-loss vs the baseline-only model.

## 6. Manual data (tags)

`data/manual/champion-tags.json` (validated by zod): per champion: `damageType` (AP/AD/mixed/none), `archetype` (enchanter/engage/poke/catch/tank/...), booleans `hardEngage`, `peel`, `poke`, `waveclear`, optional `mobility`/`burst` (D-095 lane-archetype axes), `scaling` (early/mid/late), `range`, `ccCount`. Used for compNeed, cold-start priors, lane archetypes, and explanations.
`data/manual/gameplans/<champion>.md`: optional short gameplan (level 1, matchup tips, roams, vision). Shown after pick. Optional.

## 7. Output

```
Recommendation {
  championId, score, rank,       // rank = overall rank (global), also inside poolRecommendations
  poolRank?: number              // rank inside the user's pool (D-024); only set in poolRecommendations
  reasons: Reason[]    // {type:'synergy'|'counter'|'lane'|'comp'|'blind', with: ChampionId[]?, level:0|1|2|3|-1|-2|-3, deltaPp, n, lowData}
  reliability: { nEff: number, lowData: boolean }  // baseline n_eff (real number, D-027), never a raw match count (D-030)
  warnings: string[]   // codes, never UI text: "counteredBy:<ROLE>:<championId>", "offRole" (pool champion rarely played in this role)
}
DraftResult {
  recommendations: Recommendation[]                    // overall ranking: ALL scored candidates, never truncated by the engine (D-024)
  schemaVersion: 1   // DRAFT_RESULT_SCHEMA_VERSION, bumped on every breaking output change (D-030)
  insufficientData: { championId, nEff: number, rawGames?: number, winRate?: number }[]  // baseline n_eff < minGames (§5), unscored; rawGames omitted when unknown (B-033); winRate = baseline p0 fraction when weighted evidence exists (D-054)
  poolRecommendations?: Recommendation[]               // only when input.pool is non-empty: scored pool champions in overall order (`rank` = overall rank, `poolRank` = rank in the pool)
  poolUnavailable?: { championId, reason: 'insufficientData' | 'unknownChampion' | 'picked' }[]  // pool champions without a score (numbers live in insufficientData); 'picked' = already on the board
}
```

Sorted desc. Always show why + sample sizes. Never show a % without sample size. A `Reason.n` and `Recommendation.reliability.nEff` carry the **effective sample size** `n_eff = (sum w)^2 / sum w^2` (a real number, not a raw game count), because every threshold and `lowData` flag in §5/§7 is evaluated against `n_eff`; `DraftResult.insufficientData` separately exposes `nEff`, `rawGames` and, when weighted baseline evidence exists, `winRate` for champions that fail the baseline gate. Reason type `lane`, `DraftResult.insufficientData` and the pool fields (`poolRank`, `poolRecommendations`, `poolUnavailable`) are added to the shared schemas by T-002.b.

## 7.1 Recommendation lists (D-024)

- Two lists: **From your pool** (`poolRecommendations`, shown first when the pool is non-empty; with an empty pool a one-line call to action to add champions) and **Best overall** (`recommendations`, always shown, even with an empty pool). When a profile is exported (§18), a third list labeled with the profile label (e.g. "KiriToc's picks") is shown beside them; it never changes `score(c)` or the other two lists (D-072).
- All lists are the engine's complete output, sliced client-side: the first `recommendationPageSize` items (default 5, `apps/web/src/config.ts`), then a "Show N more" button reveals the next N (N = page size) each time until the list is exhausted. A "Showing X of Y" label is always visible and the button disappears when nothing remains. The lists are paginated independently.
- The overall list also contains pool champions, tagged "In your pool". A UI-only toggle "Hide my pool" (default off) lets the user focus on champions to learn. Ranks always stay global, so gaps are expected when the toggle is on.
- Pool cards show both ranks ("#2 in your pool · #14 overall"). Pool champions without a score are listed after the ranked ones as unavailable cards with a "Not recommended" badge, the reason (insufficient data with `n_eff`/raw games and baseline win rate when available, already picked, or not in the champion catalogue); they are never hidden.
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
4. Game state bucket: `ahead` / `even` / `behind` from goldDiff & kills. Phase B (D-085): offline `item_build` buckets are time-normalized — gold diff divided by the per-(patch, 5-min bucket) standard deviation in `item_state_scale` (`stateBucketMode`), falling back to the absolute thresholds below when no scale exists; `stateZAhead`/`minStateMatches` in `ItemContextConfig`.
5. Phase (one rule everywhere, D-020/D-022): `lane` = starting items (k = 0) and completed item k = 1 bought before `laneEndSeconds` (840 s, config); `mid` otherwise.
6. Item scoring v1 (rules): `base(item) + profileFit(item) + stateFit(item, bucket) + counterFed(item, fedEnemy)` using item tags (`data/manual/item-tags.json`).
7. Item scoring v2 (data, D-022): compare like for like — context = (champion, slot `k` with 0 = starting items, purchase time bucket of 5 min, state bucket at purchase, enemy profile bucket `AD|AP|mixed`, and in the `lane` phase the lane-context slots — top `contextSlots` by lane-phase influence, §8.1). Score = shrunk win rate of the item minus the average shrunk win rate of all items bought in that context; back-off order when data is low: lane champions (exact `laneKey`, then `laneArch` archetype level, D-086) -> enemy profile -> state -> time bucket -> (champion, k). Replaces the rule score only where `n_eff >= minGames`. Observational: phrased as "players who bought X here won Y %", never as cause. Phase B (D-082/D-083): contexts aggregate only `decision_kind='item'` rows — completed/boots items at their net-replayed slot and starter purchases at slot 0; quest rewards and jungle pet upgrades are exported separately as `build-paths/` rows so they inform path decisions without polluting item pick shares; enemy profile is computed at purchase time (`unknown` when kill events are unavailable).
8. Output next 1-3 items with reasons ("enemy X is fed, AD heavy -> armor"), sample size, and what to skip.

## 9. Auto-detection (Phase 2 / Epic E6-E7)

Order of preference:

1. **LCU** (League client local API): champ select session -> fills draft.
2. **Live Client Data API** (`https://127.0.0.1:2999/liveclientdata/allgamedata`): scores, items, champions of all players during game. (Gold not exposed; estimate from items.)
3. **Image recognition** (fallback): capture screen -> portraits (template matching/embeddings vs Data Dragon icons), scoreboard: items (template matching) + K/D/A/CS (OCR). Always followed by a **correction UI**. No memory reading, no input injection.
   Read Riot's third-party policy before shipping E6/E7; log result in DECISIONS.md.

## 10. Non-functional

- Engine call < 50 ms for a full draft on a mid laptop.
- Local static app, no hosting (D-079); JSON data files < 5 MB each (gzip), lazy loaded.
- Works offline after first load (nice-to-have).
- Accessible UI, keyboard champion search; the pool editor and the "Show more" buttons are keyboard accessible.
- The pool stays in the browser (never sent anywhere).
- Show current patch + data freshness.

## 11. Out of scope (Phase 1)

Non-support roles, accounts/login, pool sync across devices or auto-import of the pool from a Riot account, server-side code, paid anything, mobile app, replays. The engine and data model are role-generic (D-020/D-021); only the SUPPORT role is populated and exposed in Phase 1.

## 12-17. Storage, retention, weights, change scoring, breakpoints (target model)

**Target model, implemented by T-019.b..T-019.f.** These sections describe the target storage and weighting model; they are normative once implemented and do not describe current code. §12 is live since T-019.b (migration `012_patches`; recency and `--since-patch` use `patch_index`). §13 is live since T-019.c (migration `013_match_rejects_pruned`; `pnpm etl prune`, `pruned` tombstones, default ingestion window). §14..§17 remain target until T-019.d/T-019.f land and T-027.a passes the D-023 gate; until then change weighting is off (`changeWeightEnabled = false`). Since T-019.e the `entity_change_scores`/`data_breakpoints` tables exist (migration `016_breakpoints_change_scores`) and manual breakpoints can be managed via `pnpm etl breakpoint`, but nothing reads them at aggregation yet.

## 12. Patch index (D-043)

Table `patches(patch_index INTEGER PRIMARY KEY, version_label TEXT NOT NULL UNIQUE)` (`released_at` was dropped by migration 014, D-055 — no release-date source exists):

- `version_label` = `major.minor`, identical to `matches.patch` (RIOT_API.md).
- `patch_index` assigned once, gap-free starting at 1, ordered NUMERICALLY by (major, minor) — never string order (`14.10` > `14.9`) — and append-only, never reassigned or renumbered. Ordering source: Data Dragon `versions.json` deduplicated to `major.minor` labels and sorted numerically (D-055); unparseable entries are skipped with a warning. Refresh verifies the stored table is gap-free and numerically ordered and that every new label sorts after the newest stored one, then appends; it refuses to renumber or misorder. Version strings are never compared for age, windows, or breakpoints; one parse (`gameVersion` -> `major.minor` label) is allowed, defined once. All age/window/breakpoint logic uses `patch_index` only.
- Hotfixes: all source versions sharing the same `major.minor` label collapse to one `patch_index`; one patch = one `patch_index`.
- A match whose label is absent from `patches`: refresh `patches` from the source first; if still absent, record an `invalid` reject. This is distinct from `patch` and `pruned` rejects.
- Read commands (`aggregate`, `derive-roles`) fetch `versions.json` at most once per run and only when the explicit snapshot label or a stored label is missing (D-055). Stored labels still unresolved afterwards are orphans: excluded from aggregates and reported by count and label, never silently. `currentPatchIndex` = the snapshot's `patch_index` when given, else the highest `patch_index` among stored matches (never the max in `patches`).

## 13. Retention and prune (D-044)

No parallel stats tables. Existing aggregate tables (`baseline`, `pair_ally`, `pair_enemy`, `lane_vs`, `lane_full`, `rune_ctx`, `item_build`, `role_prob`) are the only statistics store; recomputed on every `aggregate` run with weights baked in (SPECS §14, D-045).

- Raw `matches`/`participants`/`item_events` kept for the last N patches only (`retentionPatches`, default 20, ETL config). The retention window must contain the frozen holdout plus the training window (D-023/T-027.a). With `decay = 0.85`, data 20 patches back weighs 0.85^20 ≈ 0.04, so the default prune drops under 5% of the recency weight mass.
- `pnpm etl prune [--keep-patches N] [--dry-run]` (`N` defaults to `retentionPatches`): in ONE transaction, for matches with `patch_index <= latest - N`, write a `match_rejects` tombstone with reason `pruned` (actual `patch`, `checked_at`) and delete the match (cascade removes `participants`/`item_events`). Idempotent. `--dry-run` prints counts only. Manual use: after a major game rework (e.g. a season start or an item-system overhaul) the owner may run it once with a smaller `N` to delete older data for good; the tombstones keep that data from being re-ingested even though the default ingestion window is wider. A global `reset` breakpoint (D-047) is the reversible alternative: it zeroes the old data at aggregation without deleting it.
- `match_rejects.reason` becomes `queue|short|patch|invalid|pruned`. This extends D-017's list; do not edit D-017. `patch` keeps its D-017 meaning (re-evaluated when a run's window includes it). `pruned` is permanent: `findRejection` never deletes or re-evaluates it, whatever `--since-patch` says.
- `--reset` (D-018) clears `queue|short|patch|invalid` rejects and keeps `pruned`. Only the explicit flag `--reset-tombstones` clears `pruned`; its help text warns that pruned matches become fetchable again.
- Default ingestion window: `patch_index >= latest - retentionPatches + 1`, so ingestion never re-adds data the next prune would delete. An explicit `--since-patch` below this bound is a usage error unless `--reset-tombstones` is also given.
- If `match_rejects.reason` has a CHECK or enum in the real migrations, T-019.c adds a migration (next free number) allowing `pruned`. If not, none.
- Aggregate tables are rebuilt each run: no purge, no soft delete, no grace period. `reset` breakpoints give weight 0 at aggregation; they do not delete data. Retention and weighting are independent.
- Invariant: rows are never deleted to express a weight; they are deleted only for retention (outside the window).
- Size estimate (assumptions stated): assume `M` matches per patch (unknown; parameterize), ~20 stored rows per match (1 match + 10 participants + ~8 item events + 1 tombstone), ~150 bytes per row. Retained rows ≈ N × M × 20 × 150 bytes. For N=20, M=1000: ≈ 6 MB. Tombstones ≈ N × M × 1 row × ~60 bytes ≈ 1.2 MB. Aggregate tables bounded by key cardinality × 8 rank buckets × N patches, not by match count.

## 14. Weights (D-045)

One weight formula, stated once:

`w = rankKernel × reliability × recency × changeWeight`

- `rankKernel(gameBucket, userBucket)`, `reliability(rank_known_count, unknownRankFactor)`, `recency(decay, currentPatchIndex - patchIndex)` exist (SPECS §3, `combinedGameWeight`, D-032, D-033).
- `decay = 0.85` (SPECS §3). There is only one decay value.
- `changeWeight(entities, patchIndex, asOf)`:
  - Across time (successive change events of one entity): product of change weights at patches q with `p < q <= asOf`.
  - Across entities of the row's entity set INCLUDING the global entity: min.
  - Floor `minWeight` (default 0.05, ETL config), except `reset` = 0 (no floor).
  - Only events with `patch_index > p` AND `patch_index <= asOf` apply; `asOf` = snapshot's `currentPatchIndex` (backtest: patch before holdout).
  - An active breakpoint (SPECS §16, D-047) replaces the automatic change weight for that entity/patch with its `weight_factor`; still multiplies with change weights of other patches.
- Entity set per aggregate table:
  - baseline {champion}
  - pair_ally {champion, ally champion}
  - pair_enemy {champion, enemy champion}
  - lane_vs {champion, opp1, opp2}
  - lane_full {champion, partner, opp1, opp2}
  - rune_ctx {champion} plus every rune id of the row's page (keystone, primary style, sub style, selected perks from `perks_json`; stat shards excluded). Weight computed per game from that participant's own page.
  - item_build {champion, item}
  - role_prob {champion}
    The global entity is added to every set.
- Weights baked into `wins_w`, `games_w`, `games_w2`; `n_eff`, thresholds, exports, engine contracts unchanged.
- Purity: engine `changeWeight` is pure, receives plain data (events, breakpoints); SQLite reads stay in ETL.
- Safety: change weighting disabled by default (`changeWeightEnabled` = false; neutral weights 1.0). Enabled only after T-027.a passes the D-023 gate. With flag on and no events/breakpoints, aggregates byte-identical to current output (regression test). Every new parameter (`minWeight`, band edges/weights, default `weight_factor`) is a prior; changes only through the D-023 gate.

## 15. Change score (D-046)

Source: CommunityDragon game data, `https://raw.communitydragon.org/<major.minor>/` (same label as `matches.patch`). Data Dragon is not used for scoring (its champion files carry no ability values); it stays the source of the published catalogs and of the Summoner's Rift item filter. Files:

- champions: `plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json` (numeric id -> alias), then `game/data/characters/<alias>/<alias>.bin.json` (alias lowercased);
- items: `game/items.cdtb.bin.json` (`Items/<id>` records);
- runes: `game/perks.cdtb.bin.json` (`Perks/Styles/<Tree>/<Name>` records with `mPerkId`).

Entity sets: champions whose id is in the Data Dragon champion catalog (this drops game-mode variants such as `Jade_*`, ids >= 60001); items with Data Dragon `item.json` `maps["11"] == true` (read from the raw file: the published `items.json` does not keep `maps`); every perk.

Command `pnpm etl changes <patch>` writes `entity_change_scores(entity_type, entity_id, patch_index, content_hash, change_score, details)`; `entity_type` IN (`champion`,`item`,`rune`); `entity_id` = numeric champion/item/perk id; unique key `(entity_type, entity_id, patch_index)`; re-run overwrites. `change_score` REAL in [0,1] or NULL, rounded to 4 decimals. `content_hash` + `details` only (no snapshots). The previous patch's files are re-downloaded when needed.

Folder lifetime: a patch folder can still change while that patch is live (hotfix extractions; observed 10-12 days after release), and has stayed unchanged once the next patch is out. A score for the latest patch is therefore provisional: the command warns when `<patch>` is the latest patch, and re-running it after the next patch is released makes the score final.

Algorithm (TypeScript terms):

1. Allowlist extraction (configurable). Only these fields are read; everything else (skins, VFX, animation, icons, client/tooltip data) is ignored:
   - champion: numeric base and per-level stats of `Characters/<Name>/CharacterRecords/Root` (including `primaryAbilityResource`); for every ability of the record's `mAbilities` list, its root spell and child spells: `mSpell.DataValues`, `mSpell.mSpellCalculations` formula parts (referenced data value names and numeric parts such as `mCoefficient`), `cooldownTime`, `mana`, `castRange`.
   - item: `price`, `recipeItemLinks`, numeric `mFlat*`/`mPercent*` mods, `mDataValues`.
   - rune: `mScript.mSpellScriptData.mEffectAmount` and `mScript.mSpellScriptData.mCalculations`; per-mode overrides (`mEffectAmountGameMode`, e.g. ARAM, URF) are ignored.
2. Name normalization: every entry path and field name is compared in hashed form, FNV-1a 32-bit of the lowercased name written `{xxxxxxxx}`, because CommunityDragon resolves more hashed names over time (observed: `{89aa48b5}` became `Characters/Jade_Galio/Spells/Jade_GalioEAbility/Jade_GalioE_Haste`, field `{72c5c2a8}` became `DamageType`).
3. Named lists are keyed by name, never by position: spell `DataValues` by `name`, item `mDataValues` by `mName`.
4. Flatten into `Map<string, Leaf>` (path -> leaf), leaf `number | number[]`; numbers rounded to 6 decimals (the files store float32 values such as `0.30000001192092896`).
5. `content_hash` = sha256 of canonical JSON (sorted keys) of the map (`node:crypto`, no new dependency). Equal -> `change_score = 0`.
6. Otherwise sum contributions:
   - number: `min(1, abs(new-old) / max(abs(old), 1e-6)) * 0.5`, per-leaf cap 0.5.
   - number[] same length: `mean(relative change per index) * 0.5` (one contribution per array). Different length: 0.3.
   - duplicates: the same change (same value name, same old and new value) repeated inside one entity counts once (e.g. one Q value copied into four elemental sub-spells).
   - structural: a root spell (`mRootSpell` of an ability) added, removed or replaced -> 0.6 each; child spells (missiles, helpers) only count through their values; a data value or calculation added or removed -> 0.3 each; item recipe changed -> 0.3; stat mod added or removed -> 0.3.
7. `change_score = min(1, sum)`, rounded to 4 decimals.

Text is never compared, so tooltip rewording cannot change a score.

Properties (tested): rewording, reordering and hash resolution never change the score (allowlist, canonical JSON, name keys, hashed names); magnitude matters beyond the per-leaf cap; monotone in change size for fixed keys.

Bands (half-open): [0, 0.1) x1.0; [0.1, 0.3) x0.9; [0.3, 0.6) x0.5; [0.6, 1] creates `suggested` breakpoint (source `auto`, mode `downweight`, `weight_factor` 0.2). While a suggestion is pending or after rejection: effective weight = [0.3, 0.6) band weight (x0.5), never 1.0.

Fallback (stated once here): missing/unreadable/incomplete source, or no previous patch with data -> `change_score = NULL`, weight 1.0, warning logged (first patch: NULL, no warning). Never invent a score, never block the pipeline. All other sections reference this fallback.

Fixtures (arithmetic shown): cooldown scalar 10->9 = 0.05 ([0,0.1) x1.0); armor 30->36 (0.1) + cooldown 10->9 (0.05) = 0.15 ([0.1,0.3) x0.9); damage array [10,9,8,7,6]->[9,8,7,6,5] ≈ 0.065 ([0,0.1) x1.0); AP ratio 0.5->0.55 = 0.05 ([0,0.1) x1.0); root spell replaced = 0.6 ([0.6,1] suggested); identical = 0; skin/VFX-only change = 0; child missile added = 0; hash resolved to a name = 0; ARAM-only item = 0; ARAM-only perk override = 0. Real-JSON fixtures: trimmed CommunityDragon files of two consecutive real patches under `packages/etl/test/fixtures`.

Verification (2026-11-04, prototype on 16.20 -> 16.21 and 16.21 -> 16.22, see PROGRESS.md): of 173 champions, 145 and 53 raw files changed but only 21 and 15 champions have allowlisted changes, all of them balance values (e.g. 16.21 Caitlyn Q base damage, Varus W, Sion R ratio; 16.22 Mel base stats, Smolder, Naafiri). Items: 15 and 2 changed catalog items before the Summoner's Rift filter. Runes: no value changes in either pair. Remaining known false-positive class: internal data refactors with the same in-game effect (16.22 Orianna: `ReducedDamagePercent` 30 -> 0.7 with recalculated formulas, scored 1); these surface as `suggested` breakpoints and are rejected in review (§16). Still to do before the allowlist is frozen: compare these lists with the official patch notes. Manual breakpoints (§16, T-019.e) ship first.

## 16. Breakpoints (D-047)

DDL with table-level constraints (exact text in DATA_MODEL.md §5.4): CHECKs for `scope_type IN ('champion','item','rune','global')`; `scope_id IS NULL` iff `scope_type='global'`; `mode IN ('reset','downweight')`; `weight_factor IS NULL` for `reset` and `0 < weight_factor <= 1` for `downweight`; `status IN ('suggested','active','rejected')`; `source IN ('auto','manual')`; `reason NOT NULL` with `length(reason) > 0`; `from_patch_index >= 1`; unique expression index `idx_data_breakpoints_unique` on `(scope_type, COALESCE(scope_id, -1), from_patch_index, source)`.

- Affected data: `patch_index < from_patch_index`. An active breakpoint replaces the automatic change weight for that entity/patch with its `weight_factor`; still multiplies with change weights of other patches. Several active breakpoints on same entity/patch: `reset` dominates (0); otherwise `weight_factor`s multiply, floored at `minWeight`. One rule, same whether or not they share `from_patch_index`. A breakpoint applies at aggregation to any retained data with `patch_index < from_patch_index`; if none remains it has no effect.
- Scope table:
  - champion: `baseline`, `pair_ally`, `pair_enemy`, `lane_vs`, `lane_full`, `rune_ctx`, `role_prob` (rows keyed by champion)
  - item: `item_build` only. Champion-wide win-rate shifts from item reworks are handled by `champion` or `global` breakpoints (documented limitation; cascade is a rejected alternative).
  - rune: `rune_ctx`
  - global: all aggregate tables
- Lifecycle: `suggested -> active` (validate) or `rejected`. CLI `pnpm etl breakpoint list|add|validate|reject`. `pnpm etl status` shows "review needed" count for suggested breakpoints. Web badge out of scope. Manual `add` creates `active` row with `source='manual'` and mandatory `reason`.
- Hotfix limitation: hotfixes merged into the same `patch_index` never downweight same-patch data (known limitation; change events apply to `patch_index <` the change patch).
- Breakpoint on pruned patch: applies at aggregation to retained data with `patch_index < from_patch_index`; if none remains it has no effect.

## 17. Edge cases

Only edge cases not owned by sections 12-16; all other rules reference those sections (one normative statement per rule).

- Missing source data: `change_score = NULL`, weight 1.0, warning logged (first patch: NULL, no warning). Stated once in SPECS §15; referenced here.
- Entity renamed / ID changed between patches: new `entity_id` = new row; cross-patch comparison uses `entity_id`, so renamed entities are separate rows. Champions are keyed by numeric id from CommunityDragon `champion-summary.json` (alias such as `monkeyking` only builds the file path).
- Item passives: numeric values come from the item `DataValues` in `items.cdtb.bin.json`; description HTML is never parsed.

## 18. Personalization (D-067..D-080)

Personal recommendations use a **configured profile's** match history, synced by the pipeline and shipped as static JSON — the app is local-only and never calls Riot; there is no login or server (D-002, D-067, D-079). `score(c)` and every existing list are **unchanged** by personalization (D-072, same invariant as D-024).

### 18.1 Profile

- Declared in the committed `data/profiles.config.json` (D-068): `{ id, riotId: { gameName, tagLine }, platform, label, options }`. Default and only entry: `KiriToc#Toc`, `EUW1`. Only configured profiles are ever synced — visitors cannot add one; adding another person's profile requires their consent.
- Synced by `pnpm etl profile-sync` inside the scheduled `etl.yml` run (D-070): account-v1 resolves the Riot ID to a puuid (`europe` routing for EUW1), match-v5 fetches ranked solo/duo games (queue 420) incrementally (per-profile `last_game_creation` cursor, D-018 pattern), champion-mastery-v4 provides mastery. Stored in `profiles`/`profile_games`/`profile_mastery` (DATA_MODEL.md) and exported as `data/public/profiles/<id>.json` + `index.json`, anonymized per D-069 (no foreign names/Riot IDs/puuids/match ids; last 180 days, max `profileMaxGames` = 500). `data/public` is gitignored and local-only (D-079): the exports are packed into the `public-exports.tar.gz` asset of the newest `state-*` release in the private state repo (D-078) and reach the app via `pnpm etl pull`.
- The web app loads the exported JSON statically and displays the profile label (e.g. "Profile: KiriToc#Toc (EUW)"); the personalized list is labeled "<gameName>'s picks" — never "For you" (D-072). No profile selector UI for now; a selector among exported profiles is future work.
- Phase 1 uses Support games only; other roles are stored but ignored by the engine.

### 18.2 Profile win rate (champions)

For candidate `c` in the current draft, over the profile's in-scope games:

- Recency weight `w = 0.5^(age_days / 60)` per game (`HALF_LIFE_DAYS = 60`); `n_eff = (sum w)^2 / sum w^2`.
- Profile win rate at a context level: `p = (wins_w + K_SHRINK * p_profile) / (games_w + K_SHRINK)`, `K_SHRINK = 15`, `p_profile` = the profile's recency-weighted win rate over all in-scope games.
- Fallback hierarchy — first level with `n_eff >= MIN_GAMES` (`MIN_GAMES` = 3). Every level is scoped to games the profile played ON the candidate champion in the SUPPORT role; the levels widen the matchup context instead (D-076): L1 same ally ADC + same enemy support; L2 same enemy support; L3 enemy composition signature (`champion-tags.json` `damageType:archetype` pairs, draft signature ⊆ game signature); L4 any context ("role overall"); L5 champion overall (identical to L4 while only SUPPORT games are in scope, kept distinct for later phases). `levelFactor` = 1.0/0.9/0.8/0.7/0.6 for L1..L5. The same hierarchy gives the profile's win rate "in the current matchup/setup".
- Trust: `trust = (n_eff * levelFactor) / (n_eff * levelFactor + K_TRUST)`, `K_TRUST` = 20.
- Meta normalization: `metaNorm(c) = 1 - (rank - 1) / (N - 1)` over the complete overall list (N > 1; 1 when N = 1) — `score(c) = sigmoid(x)` is uncalibrated in absolute terms, rank position is stable.
- `personalizedScore(c) = (1 - trust) * metaNorm(c) + trust * p`. The personalized list sorts desc, tie-break overall `rank`. Entries with `n_eff < MIN_GAMES` at every level show "insufficient data" with `n_eff` (D-075), never a number.
- Reason badge per entry: shrunk profile WR %, effective games, fallback level, and the delta vs the rank-bucket baseline `d = round(100 * (p - w0))` pp, where `w0` is the champion's baseline win rate (`p0` fraction of §5) for the rank bucket selected in the app — the same value `insufficientData.winRate` exposes (D-054). The delta is omitted when the baseline row has no weighted evidence (`games_e = 0`) or the champion fails the baseline gate; a prior-only 50% is never used. The label names the bucket, e.g. "+4 pp vs Diamond avg" (D-080).

### 18.3 Personalized list UI

- List labeled with the profile label (e.g. "KiriToc's picks"), beside "Best overall" and "From your pool", same pagination (5 by 5, "Show more", independent state, resets on draft/profile change) and a11y rules as §7.1. Absent when no profile JSON is exported/loaded. Insufficient-data entries render the sample size, never a percentage.

### 18.4 Favorites (D-074)

- Computed at export: top 15 champions by recency-weighted Support games (last 90 days) union top 5 by mastery points.
- "Import favorites into pool" is explicit and respects `poolMaxSize`.
- `favoritesMode`: `include` (default, star badge) / `only` (favorites only in the lists) / `hide` (favorites removed). Filters/flags displayed entries only; `score(c)` unchanged.

### 18.5 Runes and summoner spells

- Runes screen: two columns — "Profile's best" (shrunk profile WR of the profile's rune pages for that champion, matched per draft context when possible) and "Top players" (existing `recommendRunes` output); a marker highlights entries that differ. Page identity = `(keystoneId, primaryStyleId, subStyleId)` — minor rune picks and stat shards do not split pages; summoner spells are an unordered pair normalized to `[min(id), max(id)]`; the fallback/shrinkage levels are the champion-scoped L1..L5 of §18.2 applied per setup, with the shrinkage prior = the profile's recency-weighted win rate on that champion; fewer than 5 effective games (`DEFAULT_MIN_SETUP_GAMES`) on a setup -> "Profile's best" shows insufficient data with `nEff`, never a rate (D-077/D-075).
- Summoner spells: same two-column layout from `profile_games` spell ids (profile WR per normalized spell pair vs the champion's global recommendation).

### 18.6 Items (last)

- Personalized items reuse the GameState model (§8.2, T-052+) and the profile's own purchase outcomes per state/context. Open questions (recorded before implementation): which state-bucket dimensions profile games can reproduce offline (gold diff needs timeline data — confirm `profile_games` timeline coverage), whether item personalization waits for T-056 data-driven scoring, and minimum sample sizes per item context.
- One normative statement per rule; cross-references (§14, §15, §16) used elsewhere.
