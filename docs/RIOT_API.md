# RIOT API NOTES

Always verify details at https://developer.riotgames.com (limits and endpoints may change). Mark anything verified with the date.

## Keys

- Dev key: free, expires every 24h, low limits (commonly 20 req/s and 100 req/2 min — VERIFY). Stored in `.env` (`RIOT_API_KEY`) for local runs.
- Personal key: free, no expiry, higher limits; requires a project description on the dev portal (no website/verification). Obtained 2026-11-06 for DraftOrb; stored as the GitHub Actions secret `RIOT_API_KEY` used by `.github/workflows/etl.yml` (D-057/D-078). The app is local-only (D-079); whether Riot's terms require a production key for this use is **to verify** (D-071).
- Verified 2026-11-06 (owner, dev portal): the personal key's rate limits are **20 req/s and 100 req/2 min** — the same envelope as the dev key. Budget CI runs accordingly: `matches --refresh` (~250 players) ≈ 15–25 min; `matches --limit 100` on pending players ≈ 40–70 min (up to ~20 match-detail calls per player plus enrichment).
- **PUUIDs are encrypted per API key** (verified 2026-11-06, B-062/D-060): a puuid fetched with one key returns `400 Exception decrypting` under another, on every by-puuid endpoint (league-v4, summoner-v4, champion-mastery-v4, match-v5). Match IDs are NOT affected. After changing `RIOT_API_KEY`, run `pnpm etl rekey` before any ingestion or every stored puuid is unusable.
- **Key renewal/expiry (verified 2026-11-12, developer.riotgames.com/docs/portal):** development keys deactivate every 24 h and must be reset manually on the portal; personal keys do not expire on a schedule — they persist until revoked. Portal docs state personal keys are for "products that are intended for just the developer or a small private community", "personal usage and not production", and "You may not run your application for public consumption using a personal key". The app is local-only (D-079), which is consistent with personal usage; whether the DraftOrb product is registered/audited on the portal (General Policies require registration) is **UNVERIFIED — owner action**.
- **Policy text (fetched 2026-11-12):** API Terms (developer.riotgames.com/terms) prohibit use "in a manner that exceeds reasonable request volume or constitutes excessive or abusive use" but contain no clause explicitly banning scheduled/automated use of a personal key within its limits, storing derived aggregates for personal use, or serving derived data in a local tool. General Policies (developer.riotgames.com/policies/general, last updated 2025-05-29) require product registration/audit, forbid monetization without approval, forbid creating an unfair advantage, and forbid de-anonymizing players. None of the fetched text clearly prohibits the current pipeline; the "reasonable request volume" clause and the registration requirement remain judgement calls — flagged in `docs/reports/model-review-baseline.md`.

## Method rate limits (DEVELOPMENT KEY header, pasted 2026-11-12, source: Riot Developer Portal key page)

Header: "DEVELOPMENT KEY HAS ACCESS TO 58 METHODS" (standard label for a personal key). STD means 20000 requests per 10 seconds AND 1,200,000 requests per 10 minutes. Method level only; application-level limits are NOT included in this table.

### LoL

- SUMMONER-V4: by-puuid 1600 per 1 min; summoners/me STD.
- LEAGUE-V4: challenger, master and grandmaster by-queue each 30 per 10 s AND 500 per 10 min; entries/{queue}/{tier}/{division} 50 per 10 s; entries/by-puuid STD.
- LEAGUE-EXP-V4: entries/{queue}/{tier}/{division} 50 per 10 s.
- MATCH-V5: matches/{matchId}, by-puuid/{puuid}/ids and matches/{matchId}/timeline each 2000 per 10 s.
- SPECTATOR-V5: active-games/by-summoner 3000 per 10 s AND 180000 per 10 min.
- CHAMPION-MASTERY-V4: by-puuid, by-champion, scores and top: each STD.
- CHAMPION-V3: champion-rotations STD. LOL-STATUS-V4: platform-data STD.
- LOL-CHALLENGES-V1: percentiles, {id}/leaderboards/by-level/{level}, {id}/percentiles, {id}/config, player-data/{puuid} and challenges/config: each STD.
- CLASH-V1: teams/{teamId} 200 per 1 min; tournaments/{tournamentId} 10 per 1 min; tournaments/by-team/{teamId} 200 per 1 min; tournaments 10 per 1 min; players/by-puuid STD.
- TOURNAMENT-STUB-V5: codes (POST), lobby-events/by-code, codes/{code}, providers (POST), tournaments (POST): each STD.
- ACCOUNT-V1: accounts/by-riot-id 1000 per 1 min; accounts/by-puuid 1000 per 1 min; the same two paths ALSO listed at STD; active-shards/by-game/by-puuid STD; region/by-game/by-puuid STD. (Duplicated rows: record verbatim and apply the stricter — 1000 per 1 min.)

### Other games (not used by this project)

- TFT-MATCH-V1: matches/{id} 250 per 10 s; by-puuid ids 600 per 10 s. TFT-SUMMONER-V1: by-puuid 1600 per 1 min; me STD. TFT-LEAGUE-V1: entries/{tier}/{division} 250 per 10 s; challenger, grandmaster and master each 30 per 10 s AND 500 per 10 min; rated-ladders top STD; by-puuid STD. TFT-STATUS-V1 STD.
- LOR-RANKED-V1: leaderboards 30 per 10 s AND 500 per 10 min. LOR-MATCH-V1: matches/{id} 100 per 1 hour; by-puuid ids 200 per 1 hour. LOR-STATUS-V1 STD.
- VAL-CONTENT-V1: contents 250 per 10 s. VAL-RANKED-V1: leaderboards/by-act 10 per 10 s. VAL-STATUS-V1 STD.

### Methods this project uses

| Method                              | Endpoint(s)                                                                                  | Method limit (portal, 2026-11-12) | Measured `X-Method-Rate-Limit` (2026-11-12) |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| match-v5                            | matches/{matchId}                                                                            | 2000 per 10 s                     | `2000:10`                                  |
| match-v5                            | matches/by-puuid/{puuid}/ids                                                                 | 2000 per 10 s                     | `2000:10`                                  |
| match-v5                            | matches/{matchId}/timeline                                                                   | 2000 per 10 s                     | `2000:10`                                  |
| league-v4                           | entries/{queue}/{tier}/{division}, leagues by-queue                                          | 50 per 10 s (entries); 30/10s+500/10min (challenger/master/GM by-queue) | `20000:10,1200000:600` (STD — by-puuid) |
| league-v4                           | entries/by-puuid/{puuid}                                                                     | STD                               | `20000:10,1200000:600`                     |
| league-exp-v4                       | entries/{queue}/{tier}/{division}                                                            | 50 per 10 s                       | not used by the project                    |
| summoner-v4                         | by-puuid                                                                                     | 1600 per 1 min                    | not used by the project                    |
| account-v1                          | accounts/by-riot-id/{gameName}/{tagLine}                                                     | 1000 per 1 min (stricter of the two duplicated rows) | `1000:60`                    |
| champion-mastery-v4                 | by-puuid top, by-puuid/by-champion                                                           | STD                               | `20000:10,1200000:600`                     |
| spectator-v5                        | active-games/by-summoner                                                                     | 3000 per 10 s AND 180000 per 10 min | not used by the project                  |

## Effective limits

Measured from live response headers on 2026-11-12 (EUW1 platform / europe regional routing, personal key):

- `X-App-Rate-Limit: 100:120,20:1` on every response → application windows of **100 requests / 120 s** and **20 requests / 1 s**.
- `X-App-Rate-Limit-Count` observed at `54:120,1:1` … `57:120,3:1` during measurement — i.e. the scheduled pipeline shares the same application budget; local runs compete with it.
- `X-Method-Rate-Limit` observed: match-v5 `2000:10` (200 req/s), league-v4 by-puuid and champion-mastery-v4 `20000:10,1200000:600` (STD), account-v1 by-riot-id `1000:60` (16.7 req/s).

Formula: `effectiveRate = min over all app and method windows of limit/window`.

- Application: min(100/120, 20/1) = **0.833 req/s ≈ 72,000 req/day**.
- Methods used by the project are all ≥ 16.7 req/s, far above the application limit.

**The application-level limit binds**: ~0.833 req/s ≈ 72k calls/day, shared between the scheduled workflow and any local run. Prior docs' "100 req/2 min" estimate is confirmed by measurement. Discrepancy vs earlier project estimates (≈8% utilization at current volume): with ~24k stored matches and ~2 calls/match plus listings, a full-history refresh is ~50k calls ≈ 17 h of budget — the practical constraint is now **daily call budget**, not per-run rate.

Real calls per stored match (steady state, after timeline coverage is complete): 1 match detail + 1 timeline + amortized match-id listing (~0.02–0.05) + amortized enrichment (league-v4 by-puuid cached per puuid, mastery only for low-`champion_games` role participants) ≈ **2.1–2.3 calls/match**.

## Routing

- Platform routing (`euw1`, `na1`, `kr`...) for league-v4.
- Regional routing (`europe`, `americas`, `asia`, `sea`) for match-v5.

## Endpoints used

| Need                                 | Endpoint (VERIFY)                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players by tier/division             | league-v4 `entries/{queue}/{tier}/{division}`, plus `challengerleagues`, `grandmasterleagues`, `masterleagues`                                                                                                                                                                                                                                        |
| Match ids per player                 | match-v5 `matches/by-puuid/{puuid}/ids` (filter queue=420 ranked solo, startTime)                                                                                                                                                                                                                                                                     |
| Match detail                         | match-v5 `matches/{matchId}`                                                                                                                                                                                                                                                                                                                          |
| Timeline                             | match-v5 `matches/{matchId}/timeline` (E5 only — costs extra requests)                                                                                                                                                                                                                                                                                |
| Champion mastery (experience filter) | champion-mastery-v4 `champion-masteries/by-puuid/{puuid}/by-champion/{championId}` — expert fallback (D-022), one call per (puuid, champion) pair, cached in `participants.mastery_points` (T-014)                                                                                                                                                    |
| Riot ID -> puuid (profiles)          | account-v1 `accounts/by-riot-id/{gameName}/{tagLine}` — regional routing (`europe` for EUW1); returns puuid + accountId (VERIFY endpoint shape)                                                                                                                                                                                                       |
| Own match ids (profiles)             | match-v5 `matches/by-puuid/{puuid}/ids` (queue=420, `startTime` incremental like D-018) — regional routing                                                                                                                                                                                                                                            |
| Own match detail + timeline          | match-v5 `matches/{matchId}` and `matches/{matchId}/timeline` — timeline adds ~1 request per game, used for the item build order in `profile_games.items_ordered_json` (D-068 assumption, VERIFY cost)                                                                                                                                                |
| Own champion mastery (favorites)     | champion-mastery-v4 `champion-masteries/by-puuid/{puuid}/top?count=200` — platform routing                                                                                                                                                                                                                                                            |
| Static data                          | Data Dragon: `https://ddragon.leagueoflegends.com/` (versions.json newest-first — reverse for `patch_index` ordinal; `item.json` with `maps["11"]` for the Summoner's Rift filter) — no key needed. Change scoring (D-046, SPECS §15) uses CommunityDragon `https://raw.communitydragon.org/<major.minor>/` game data instead (community-run, no key) |

Not implemented in `RiotClient` yet: `getMatchTimeline` exists but is not used yet and returns an unvalidated payload (T-051). Champion mastery-v4 is implemented (`getChampionMastery`, T-014).

## Client requirements (T-010)

- Token-bucket rate limiter honoring both limits; reads `X-App-Rate-Limit` / `X-Method-Rate-Limit` headers.
- On 429: wait `Retry-After`. On 5xx: exponential backoff (max 5 tries). On 401/403: stop with explicit message "key expired?". Network errors and non-JSON 2xx bodies are retried with the same backoff budget as 5xx.
- Resumable: persist cursors in `ingest_state`. Idempotent: skip known `match_id`.
- Zod-validate responses supplied with a schema. An unrecognized shape throws `RiotSchemaError`; callers must surface or explicitly handle it rather than treating it as transient. Every endpoint used by ingestion (league entries and leagues, match ids, match detail) passes a schema, and match ingestion records a `RiotSchemaError` as an `invalid` reject. Only `getMatchTimeline` is fetched without a schema and returns the raw payload.

## Data quality notes

- Rank of a player is the CURRENT rank at collection time (approximation of rank at game time). Document in DECISIONS.md.
- Use `teamPosition` for roles (can be empty in remakes — drop those). Filter queue 420, duration > 15 min.
- Keep `patch` = first two numbers of `gameVersion`.
- Verified 2026-11-04: Data Dragon `item.json` `maps["11"]` is the Summoner's Rift flag (315 of 863 items on 16.21.1).
- Verified 2026-11-04: CommunityDragon rune values are in `game/perks.cdtb.bin.json`; patch folders change while the patch is live (hotfixes) and have stayed unchanged once the next patch is out (SPECS §15).
- Profiles (T-091, D-068/D-070): `profile-sync` runs inside the scheduled `etl.yml` workflow (and locally via `pnpm etl profile-sync`); it reads `RIOT_API_KEY` from GitHub Secrets in CI and `.env` locally — the key never reaches the browser or the built site (D-067/D-069). Budget ~2-3 requests per new synced game (match detail + timeline + amortized mastery) plus 1 account-v1 and 1 mastery call per profile per run — negligible next to the ~250-player match refresh at 100 req/2 min. Only configured profiles in `data/profiles.config.json` are synced. PUUIDs fetched under the current key only — the per-key encryption note above applies; after a key change, profile puuids need the same re-key treatment as `participants` (open question, D-071). The web app never calls Riot: profiles ship as anonymized JSON (D-069). ToS: personal use of official endpoints with the owner's own key; the profile owner's stats are published with their consent (D-068); no third-party data (golden rule 1).
- Key expiry for scheduling (D-071): Development keys expire every 24 h and CANNOT drive the scheduled pipeline. The personal key (no expiry, obtained 2026-11-06) is the current `RIOT_API_KEY` secret. Whether a **production key** is required for the pipeline's use — the app is local-only since D-079, so the earlier "public site" trigger no longer applies — is **to verify** with the Riot dev portal terms; do not assume, check the current developer terms.

## Third-party/in-game tools (E6/E7)

- Live Client Data API is official and local. LCU API is unofficial but widely used.
- Read Riot's current policy on in-game assistance tools BEFORE shipping E6/E7. Record conclusion in DECISIONS.md. Never read game memory, never automate inputs.
- Add the required legal notice ("not endorsed by Riot Games") to the site.
