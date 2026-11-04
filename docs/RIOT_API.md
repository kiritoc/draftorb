# RIOT API NOTES

Always verify details at https://developer.riotgames.com (limits and endpoints may change). Mark anything verified with the date.

## Keys

- Dev key: free, expires every 24h, low limits (commonly 20 req/s and 100 req/2 min — VERIFY). Stored in `.env` (`RIOT_API_KEY`).
- Production key: free but requires an approved application. Apply early, with a clear product description (free, no paywall).

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

## Third-party/in-game tools (E6/E7)

- Live Client Data API is official and local. LCU API is unofficial but widely used.
- Read Riot's current policy on in-game assistance tools BEFORE shipping E6/E7. Record conclusion in DECISIONS.md. Never read game memory, never automate inputs.
- Add the required legal notice ("not endorsed by Riot Games") to the site.
