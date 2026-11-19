# BL-007 — Database size and growth report

Measured 2026-11-19 on a **copy** of `data/DraftOrb.sqlite` pulled from state
release `state-20261112T1035Z` (`pnpm etl pull --db`), opened read-only after
applying the 4 pending migrations (017–020). The ETL was never locked; all
queries ran on the copy. `dbstat` is available in the bundled
`better-sqlite3@13.0.3` (SQLite compiled with `SQLITE_ENABLE_DBSTAT_VTAB`).

## Sizes

| Metric                            | Value                                       |
| --------------------------------- | ------------------------------------------- |
| DB file                           | 1,296,912,384 B = **1.208 GiB**             |
| gzip -6 (published asset style)   | 219,231,476 B = **209.1 MiB** (ratio 0.169) |
| gzip -1                           | 254,072,325 B = 242.3 MiB                   |
| dbstat payload total              | ~1,180 MB                                   |
| 2 GiB release-asset limit (D-091) | asset uses **~10%** of the limit            |

VACUUM note (owner requirement): compaction needs up to **2× free space** on
the runner — ~2.4 GiB free today, growing with the DB.

## Row counts

| Table        |                 Rows |     | Table           |    Rows |
| ------------ | -------------------: | --- | --------------- | ------: |
| rune_ctx     |            1,206,980 |     | lane_vs         | 554,072 |
| pair_enemy   |            1,091,712 |     | lane_full       | 733,120 |
| pair_ally    |              866,992 |     | baseline        |   5,744 |
| participants |              267,650 |     | matches         |  26,765 |
| players      | 21,088 (+5 w/o tier) |     | patches         |     319 |
| ingest_state |                1,657 |     | match_rejects   |     629 |
| role_prob    |                  718 |     | profile_mastery |     138 |

**All raw timeline tables are empty** (0 rows): `item_events`, `kill_events`,
`lane_snapshots`, `participant_challenges`, `participant_starters`,
`item_build`, `entity_change_scores`, `data_breakpoints`,
`item_state_scale`, `match_participant_ids`, `profile_games`,
`extractor_runs`. `matches.fetched_timeline = 0` for all 26,765 matches.

The state-DB lineage predates migrations 017–020 (applied 2026-11-19): the
published DB never contained timeline data. AUDIT §5h's 5.28 GiB /
`item_events` ~72% measurement (2026-11-15) was taken on the **old local DB**,
not on this state lineage — the two are not comparable.

## Per-table bytes (dbstat payload, table + its indexes)

| Object                                              |  Payload | Share |
| --------------------------------------------------- | -------: | ----: |
| rune_ctx                                            | 631.8 MB | 53.5% |
| participants                                        | 219.8 MB | 18.6% |
| pair_enemy                                          |  97.1 MB |  8.2% |
| lane_full                                           |  85.9 MB |  7.3% |
| pair_ally                                           |  77.2 MB |  6.5% |
| lane_vs                                             |  59.9 MB |  5.1% |
| everything else (players, matches, ingest_state, …) |    ~8 MB | <0.5% |

The database is ~**99% derived aggregate tables** (`rune_ctx`, `pair_*`,
`lane_*`, `baseline`, `role_prob`) plus the raw `matches`/`participants`/
`players` inputs. `data/public` exports are computed from these aggregates —
**public aggregates are unaffected** by anything done to the empty timeline
tables, and aggregate tables are rebuilt by `pnpm etl aggregate` on every run.

## Growth estimate — UNVERIFIED (insufficient history)

Method attempted: `ingest_state` `updatedAt` per `match-ingest:*` player key.
Result: all 1,650 player cursors were written on a **single day, 2026-11-12**
(the initial bulk ingest); the state repo itself only exists since ~2026-11-08.
There is not enough history for a daily rate — confidence: **unverified**.

Bounded projection instead:

- Pending backlog: the cancelled ETL runs show ~1,650 players still to
  refresh plus new pending players; at ~12–20 stored matches/player this is
  roughly **+20k–33k matches vs the current 26,765** — matches/participants
  could ~double → file ~2 GiB, gzip asset ~350–450 MiB. Still far under the
  2 GiB asset limit.
- **The real growth risk is the timeline backfill**, not match ingestion.
  AUDIT §5h measured the `item_events` family at ~3.81 GB for 10,633 matches
  (~358 KB/match, indexes included). Extrapolated to 26,765 matches that is
  ~9.6 GB uncompressed; even at the observed 0.169 gzip ratio the published
  asset would approach **~1.6 GiB — near the 2 GiB cap** — before counting
  `kill_events`, `lane_snapshots`, `participant_challenges`,
  `participant_starters` and `item_build`. The `timeline` step is bounded
  (`--limit 200`/run) so this lands gradually, but the retention decision
  (D-122) is needed **before** the backfill drains.

## State-repo privacy check

`kiritoc/draftorb-state` verified `PRIVATE` on 2026-11-19. Automated check
added: `node scripts/check-state-repo-private.mjs` (same repo resolution as
the ETL: `--repo`, `DRAFTORB_STATE_REPO`, else `draftorb-state` under the
origin owner; fails unless `gh repo view` reports `PRIVATE`). Wiring it into
a scheduled workflow needs the state-repo token — deferred to a follow-up.
