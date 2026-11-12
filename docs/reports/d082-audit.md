# D-082 audit — item-build contexts (Phase A report)

Date: 2026-11-12. Scope: audit only, no behavior change. Sources: PR #57 diff
(`t-051-timeline-item-builds`), Data Dragon `item.json` 16.22.1 (raw CDN fetch,
863 items), the local SQLite DB (`data/DraftOrb.sqlite`, 3,597 matches,
35,970 participants), 12 hand-fetched match-v5 timelines plus 150 matches
ingested through `pnpm etl timeline euw1 --limit 150` (33,883 `item_events`
rows) for event-shape and sparsity statistics. No foreign player identifiers
are reproduced here.

## A1. Merge status and D-082 clause map

**Merge status (rule 2.6):** T-051 is implemented only on branch
`t-051-timeline-item-builds`, PR #57 **OPEN, not merged**. On `main`,
`item_events`/`item_build` exist as tables (migration 004) but are never
populated and no export emits build files (`data/public/16.22/roles/SUPPORT/`
contains `runes/` only — no `builds/`). Nothing merged to `main` and nothing in
a released export or the web app consumes any D-082 behavior. **Conclusion:
Phase B changes defaults directly in this PR lineage; no legacy config flags
are required** (the prompt's rule-2.6 escape hatch does not apply).

| Clause  | Content                                                                            | Code location                          | Verdict                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| D-082.1 | Completed item = empty `into`, not Consumable/Trinket, **not `Lane`**; boots count | `item-events.ts` `classifyItem`        | **AMEND** — core kept, but the `Lane` catch-all misclassifies quest rewards as non-items and jungle pets as completed (A2/A3) |
| D-082.2 | `item_events.ts` raw ms, /1000 at aggregation                                      | `item-events.ts`, `aggregate-items.ts` | **KEEP** — verified                                                                                                           |
| D-082.3 | `profile_key` from FINAL KDA + `items_json`                                        | `aggregate-items.ts` `enemyStates`     | **SUPERSEDE** — outcome leakage + train/serve skew (D3); replace with at-purchase `kill_events`/`ownedItemsAt`                |
| D-082.4 | State bucket = OR-rule, absolute 2000 g / 3 kills, ahead priority                  | `item-context.ts` `itemStateBucket`    | **SUPERSEDE** — time bias proven (A5); replace with time-normalized z-score                                                   |
| D-082.5 | `item_build` weight = recency × reliability, no rank kernel                        | `aggregate-items.ts` `baseW`           | **KEEP** — rank question deferred to B7 measurement (D6)                                                                      |
| D-082.6 | `lane_key` = full influence-sorted slot list, drop whole dimension                 | `aggregate-items.ts` `laneKeyOf`       | **AMEND** — keep stored keys, add archetype-level derived level at export (D5)                                                |
| D-082.7 | `lane_key=''` outside lane phase → absent `laneKey` at export                      | `aggregate-items.ts`, exporter         | **KEEP** — verified                                                                                                           |

Ticket status: T-051 **REVIEW** (this PR), T-056 **TODO**, T-027.b **TODO**,
T-050 (item tags) **TODO** — item recommender chain does not exist yet.

## A2. Item taxonomy audit (Data Dragon 16.22.1, Summoner's Rift)

Filter used for "Summoner's Rift store item": `maps["11"] == true`,
`gold.purchasable == true`, non-empty name, `hideFromAll` falsy,
`inStore != false`. **Caveat:** the stored `ItemsMap` (`itemSchema`,
`.strict()`) drops `maps`, `depth`, `specialRecipe`, `inStore`,
`hideFromAll`, `requiredChampion`, `consumed`, `stacks` — the ETL catalog
cannot currently filter by map or see the `specialRecipe` quest links. Raw
DDRagon fields were used for this audit; `classify-items` (B1) will need the
raw fields or an extended schema — **open question Q6**.

Counts: 863 total items, **253 SR-purchasable** store items. Under the
current `classifyItem`: 160 `completed`, 80 `component`, 13 `consumable`.

### Lane-tagged items (24 SR-purchasable)

| Group               | Items                                                                                                                                        | Current class                            | Correct class (proposed)                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------- |
| Doran's starters    | 1054 Shield, 1055 Blade, 1056 Ring, 1086 Bow, 1120 Helm                                                                                      | component→slot 0                         | `starter`                                         |
| Other lane starters | 1083 Cull                                                                                                                                    | component→slot 0                         | `starter`                                         |
| Support quest line  | 3865 World Atlas (`specialRecipe`→3866), 3866 Runic Compass, 3867 Bounty of Worlds (`specialRecipe`→3866, `into`=[3869,3870,3871,3876,3877]) | component                                | `quest_line`                                      |
| Quest rewards       | 3869 Celestial Opposition, 3870 Dream Maker, 3871 Zaz'Zak's Realmspike, 3876 Solstice Sleigh, 3877 Bloodsong (`from`=[3867])                 | component (**invisible — D1 confirmed**) | `quest_reward`                                    |
| Jungle pets         | 1101/1105 Scorchclaw, 1102/1106 Gustwalker, 1103 Mosstomper (`tags=['Jungle']`, `into`=[])                                                   | **completed (BUG — D2 confirmed)**       | `jungle_path`                                     |
| Lane components     | 1036 Long Sword and similar (`Lane`+non-empty `into`)                                                                                        | component                                | `component`, `laneFamily=true`                    |
| Consumables/wards   | 2003 Health Potion, 2031 Refillable, 2055 Control Ward, 3330 Scarecrow, 3340 Stealth Ward                                                    | consumable                               | `consumable`/`trinket`/`ward` (earlier rules win) |
| Ambiguous           | 2051 Guardian's Horn, 3112 Guardian's Orb, 3177 Guardian's Blade, 3184 Guardian's Hammer, 663039 Atma's Reckoning                            | component (invisible)                    | **unclassified → owner decision** (Q3)            |

Quest chain reconstruction (from `specialRecipe`/`from`/`into`, not names):
`3865 World Atlas` -(specialRecipe)→ `3866 Runic Compass` -(specialRecipe)→
`3867 Bounty of Worlds` -(`into`)→ 5 rewards (`from`=[3867]). Internal
non-store nodes 1203 "Support Quest", 1204 "Jungle Quest", 1208 "Support
Quest Reward", 1205/1209/1210/1211 jungle rewards are `purchasable=false`,
`inStore=false`, `maps[11]=false` — they appear only as `ITEM_DESTROYED`,
never purchases. Legacy support line 3850–3864 (Spellthief's→Black Mist
Scythe) is `maps[11]=false` — not SR. The 223xxx/322xxx/326xxx/663xxx/667xxx/
8010/8020/4005 ids are mode-variant duplicates (Arena/Mayhem) that DDRagon
still flags `maps[11]` — ~30 items inflate the "completed" class but are
never bought on SR.

**Misclassifications under D-082.1 as implemented:**

1. Jungle pets (6 SR ids) → `completed`: they emit `ITEM_PURCHASED` at ~2–15 s
   and currently take `item_slot = 1`, shifting every real item (A3).
2. Quest rewards (5 ids) → `component`: invisible everywhere (D1).
3. `Lane`-tagged legitimate completed items (Guardian's family, Atma's
   Reckoning, possibly Cull semantics) → `component` (D2 brittleness).
4. World Atlas purchases arrive with `participantId = 0` → skipped entirely
   (A3), so SUPPORT `item_slot = 0` is effectively empty.

## A3. Item events audit (real payloads)

Stored today: `item_events` rows of `type='purchase'` (32,210) and
`'sold'` (1,265) for the 150 freshly ingested matches. **Undo and destroyed
events are NOT stored** (replay-only in `item-events.ts`). Kill events are
not stored at all (`kill_events` does not exist). Of 3,597 stored matches,
150 (4.2%) now have item events; the remaining backlog is unfetched.
`CHAMPION_KILL` occurs ~52×/match in the sample timelines.

Payload shapes verified on 12 live EUW1 timelines (patch 16.22):

- `ITEM_PURCHASED {timestamp, type, participantId, itemId}` — no gold field.
- `ITEM_SOLD {timestamp, type, participantId, itemId}`.
- `ITEM_DESTROYED {timestamp, type, participantId, itemId}` — fires for quest
  transitions AND item combines (components destroyed at the same ms the
  result is purchased, e.g. `ITEM_DESTROYED 3866+1203` then
  `ITEM_DESTROYED 3867` + `ITEM_PURCHASED 3869` at the same timestamp).
- `ITEM_UNDO {timestamp, type, participantId, beforeId, afterId, goldGain}`:
  - Purchase undo of a normal item: `beforeId=<item>, afterId=0,
goldGain=+refund` (e.g. potion +50, Doran's Bow +400, pet +450).
  - Purchase undo of a trinket/ward: `beforeId=0, afterId=<item>,
goldGain=0` — same field shape as a sale undo.
  - Sale undo: `beforeId=0, afterId=<item>, goldGain<0` (Dark Seal sale then
    undo, goldGain −140). **The `beforeId=0/afterId>0` shape is ambiguous**
    between "undo a trinket purchase" and "undo a sale"; disambiguation must
    use live inventory state (was the item held or sold?), not the fields
    alone. Current T-051 code always treats it as a sale undo — harmless for
    `item_build` (trinkets never aggregate) but wrong for `ownedItemsAt`.
- `CHAMPION_KILL {timestamp, type, killerId, victimId, assistingParticipantIds,
bounty, shutdownBounty, killStreakLength, victimDamageDealt,
victimDamageReceived, victimTeamfightDamageDealt,
victimTeamfightDamageReceived, position}`. `killerId=0` occurs (turret/
  minion last-hit kills, 2/629 in sample) → `killer_pid` must be NULL, never 0.
- `info.participants[]` = `{participantId, puuid}` only — **no role, no
  team**; team/role come from stored `participants`.
- **`participantId = 0` pseudo-id**: every `ITEM_PURCHASED 3865` (World
  Atlas) in all 12 timelines carries `participantId: 0`, exactly 2 per match
  (both supports), at `timestamp: 0`. Quest-line DESTROYs are properly
  attributed. The Atlas purchase is therefore unattributable from the
  timeline alone → currently skipped → SUPPORT `item_slot=0` has **1 row in
  150 matches** (A5). See Q1.
- Duplicate `ITEM_PURCHASED` rows exist (two Health Potions, same participant,
  same millisecond) → the current PK `(match_id,puuid,ts,item_id,type)` would
  collapse them under `INSERT OR REPLACE`; B2's raw-event table needs a
  sequence/discriminator column.

Purchase-time histogram (first 180 s, all roles, 32,210 purchases):
0–10 s: 280, 10–20 s: 89, 20–30 s: 14, 30–40 s: 9, 40–60 s: ~0,
60–120 s: ~8. Per-role share of purchases ≤180 s: ADC 16%, JUNGLE 12%,
MID 17%, SUPPORT 15%, TOP 17%. The opening cluster ends ~30–40 s; the first
real components arrive ~60–135 s. **Proposed `starterWindowSeconds = 45`**
(covers the cluster with margin; the 90 s default also sweeps in early
component buys like Dark Seal at ~135 s — actually outside either window;
Cull purchases observed at 179–228 s stay outside). Owner to confirm (Q2).

## A4. Path decisions (12-game sample — small, indicative only)

- **Jungle path = pet choice** (the only jungle path decision observable as an
  item purchase in 16.22): 24 junglers, pets purchased at p25/p50/p75 =
  4.1 s / 6.3 s / 11.8 s. Distribution: Gustwalker Hatchling (1102/1106) 13,
  Scorchclaw Pup (1101/1105) 12, Mosstomper Seedling (1103) 1; 2 purchases
  later undone. Pets are destroyed ~700–960 s together with item 1204
  ("Jungle Quest") — **no jungle-upgrade item purchase exists in the 16.22
  SR catalog**; the upgrade is not an item event.
- **Support path = quest reward choice**: only **1 reward purchase in 24
  support games** (3869 Celestial Opposition at 768 s ≈ 12.8 min, simultaneous
  with the 3867 destroy). Other supports destroyed 3865→3866→3867 without a
  reward purchase — either the quest was abandoned at the final step or the
  reward is not always purchased. n=1 is too small for a distribution; the
  mechanism is confirmed observable when it happens. Guardian's items
  (2051/3112/3177/3184) were never purchased in 150 matches.

## A5. Context sparsity (150 ingested matches ≈ 4.2% of DB; extrapolate ×24)

Champion-level (all 3,597 matches, SUPPORT): top-30 supports have
**76–494 games** each (median 177, n_eff ≈ games since weights ≈1 at current
patches) — champion level is NOT the constraint.

Item-context cells (SUPPORT purchases with `item_slot`, 150 matches;
purchases, not distinct matches — true `n_eff` is lower):

| Back-off level  | Cells | Median purchases/cell | p90 | Cells ≥5 purchases |
| --------------- | ----- | --------------------- | --- | ------------------ |
| champion + slot | 233   | 2                     | 12  | 32%                |
| + time_bucket   | 437   | 1                     | 5   | 15%                |
| + state_bucket  | 636   | 1                     | 3   | 5%                 |
| + lane flag     | 637   | 1                     | 3   | 5%                 |

`profile_key` (3 values) is not yet included and will divide cells further.
Extrapolated to the full backlog (×24): median cell ≈ 24–48 purchases, but
the ≥`minGames` share at deep levels stays low single-digit % — **the
back-off chain is load-bearing; the exact lane level will almost never fire
for most champions** (D5 confirmed). `item_slot=0` for SUPPORT is empty
(Atlas skipped) — the single most important Phase-1 context has ~zero data.

**State-bucket time bias (D4 proven):** share of `even` by 5-min bucket over
slot purchases — 0–5 min: 91% even; 5–10: 45%; 10–15: 22%; 15–20: 14%;
20–25: 7%; 25–30: 11%. Absolute 2000 g / 3 kills thresholds are unreachable
early and nearly always exceeded late: the bucket measures game time, not
state. Same pattern over all purchases.

## A6. Owner questions (blocking Phase B)

1. **World Atlas attribution**: support quest purchases arrive as
   `ITEM_PURCHASED participantId=0` (2/match, identical, t=0). Options:
   (a) attribute one Atlas per SUPPORT participant deterministically
   (both events are identical — assignment is arbitrary but harmless since
   the item is the same); (b) treat Atlas as implied for every SUPPORT and
   never store the purchase; (c) skip and accept empty slot-0 bundles.
   Recommend (a) — preserves the raw fact and gives every support a starter.
2. **`starterWindowSeconds`**: audit supports **45 s** (cluster ends ~30–40 s).
   Current code uses 90 s.
3. **Guardian's Horn/Orb/Blade/Hammer + Atma's Reckoning**: Lane-tagged,
   SR-mapped, `into`=empty, never purchased in 150 real matches — likely
   mode-variant leftovers. Proposed class `excluded`; confirm.
4. **Undo `beforeId=0/afterId>0` ambiguity** (trinket purchase-undo vs
   sale-undo): proposed rule — match against live state (undo reverts the
   most recent _unresolved_ transaction for that item; a held item ⇒
   purchase undo, a sold item ⇒ sale undo). Acceptable?
5. **Jungle path scope**: pets are the only observable jungle path decision;
   there is no jungle-upgrade item in 16.22. Should `jungle_path` cover only
   pet selection, or wait for a future patch that adds upgrade items?
6. **Item catalog fields**: `itemSchema` drops `maps`/`specialRecipe`/
   `inStore`/`hideFromAll`. `classify-items` needs `specialRecipe` (quest
   chain) and `maps` (SR filter). Extend the schema + re-import static data
   (schemaVersion bump), or classify from the raw CDN fetch only?
   Recommend extending `itemSchema` (shared, versioned) — the engine will
   need `item-classes` anyway.
7. **Rank dimension (D6/B7)**: champion-level n_eff is ample; context-level
   is sparse regardless. Proceed with pooled (no rank column) and revisit
   only if B7 numbers say otherwise?

## Proposed order of work (Phase B)

B2 raw events + kill_events + extractor registry + backfill (foundation for
everything else) → B1 taxonomy + `classify-items` + path rows → B4 starter
bundles → B3 at-purchase threat profile → B5 state scale → B6 lane
archetype level → B7 rank measurement → B8 export/schema → B9 tests → B10
docs/ADRs.
