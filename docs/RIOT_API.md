# RIOT API NOTES

Always verify details at https://developer.riotgames.com (limits and endpoints may change). Mark anything verified with the date.

## Keys

- Dev key: free, expires every 24h, low limits (commonly 20 req/s and 100 req/2 min — VERIFY). Stored in `.env` (`RIOT_API_KEY`).
- Production key: free but requires an approved application. Apply early, with a clear product description (free, no paywall).

## Routing

- Platform routing (`euw1`, `na1`, `kr`...) for league-v4.
- Regional routing (`europe`, `americas`, `asia`, `sea`) for match-v5.

## Endpoints used

| Need                                 | Endpoint (VERIFY)                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players by tier/division             | league-v4 `entries/{queue}/{tier}/{division}`, plus `challengerleagues`, `grandmasterleagues`, `masterleagues`                                                                                     |
| Match ids per player                 | match-v5 `matches/by-puuid/{puuid}/ids` (filter queue=420 ranked solo, startTime)                                                                                                                  |
| Match detail                         | match-v5 `matches/{matchId}`                                                                                                                                                                       |
| Timeline                             | match-v5 `matches/{matchId}/timeline` (E5 only — costs extra requests)                                                                                                                             |
| Champion mastery (experience filter) | champion-mastery-v4 `champion-masteries/by-puuid/{puuid}/by-champion/{championId}` — expert fallback (D-022), one call per (puuid, champion) pair, cached in `participants.mastery_points` (T-014) |
| Static data                          | Data Dragon: `https://ddragon.leagueoflegends.com/` (versions.json, champion.json, item.json, runesReforged.json) — no key needed                                                                  |

## Client requirements (T-010)

- Token-bucket rate limiter honoring both limits; reads `X-App-Rate-Limit` / `X-Method-Rate-Limit` headers.
- On 429: wait `Retry-After`. On 5xx: exponential backoff (max 5 tries). On 401/403: stop with explicit message "key expired?".
- Resumable: persist cursors in `ingest_state`. Idempotent: skip known `match_id`.
- Zod-validate responses; log unknown shapes instead of crashing.

## Data quality notes

- Rank of a player is the CURRENT rank at collection time (approximation of rank at game time). Document in DECISIONS.md.
- Use `teamPosition` for roles (can be empty in remakes — drop those). Filter queue 420, duration > 15 min.
- Keep `patch` = first two numbers of `gameVersion`.

## Third-party/in-game tools (E6/E7)

- Live Client Data API is official and local. LCU API is unofficial but widely used.
- Read Riot's current policy on in-game assistance tools BEFORE shipping E6/E7. Record conclusion in DECISIONS.md. Never read game memory, never automate inputs.
- Add the required legal notice ("not endorsed by Riot Games") to the site.
