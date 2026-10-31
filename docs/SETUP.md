# SETUP (Windows, minimal)

## Prerequisites

1. **Node.js 22** (https://nodejs.org) — the version CI tests and the minimum supported version. Node 20 is no longer supported: `better-sqlite3` 13.x requires Node >=22 and segfaults on Node 20 (B-015).
2. **pnpm**: in PowerShell `corepack enable`; Corepack then uses the pnpm version pinned in `package.json` (`packageManager`). Alternative: `npm i -g pnpm`.
3. **Git**.
4. (Optional) VS Code. No Python, no Java, no Docker, no compiler needed.

## First run

```
git clone <repo> && cd DraftOrb
pnpm install
copy .env.example .env      # then edit RIOT_API_KEY
pnpm test
pnpm check                   # typecheck + lint + format check + tests (what CI runs)
pnpm dev
```

## Riot key

1. Sign in at https://developer.riotgames.com, copy the Development API Key (expires every 24h).
2. Paste into `.env`. Re-paste daily until a production key is approved.

## ETL commands

The database is `data/DraftOrb.sqlite` unless `DRAFTORB_DB_PATH` is set. `pnpm etl help` lists the commands and exit codes.

Implemented:

```
pnpm etl migrate [db-path]     # create/upgrade SQLite (also: pnpm migrate)
pnpm etl static [version]      # Data Dragon import -> data/public/<patch>/
pnpm etl validate-tags         # validate data/manual/champion-tags.json (also: pnpm validate:tags)
pnpm etl check-key [platform]  # test the Riot API key (default: euw1)
pnpm etl players [platform]    # discover players by tier (--tiers, --quota, --reset)
pnpm etl matches [platform]    # ingest matches, resumable, Ctrl+C safe (--since-patch, --per-player, --limit, --queue, --min-duration, --reset)
pnpm etl status [platform]     # counts and progress
pnpm etl aggregate             # compute aggregated tables (role probabilities and rank-weighted baselines; T-015, T-016)
pnpm etl derive-roles [patch]  # rewrite champions.json.roles from observed roles (T-015.b); run after `matches`, and re-run after every `static`
```

Planned (target state, see TICKETS.md):

```
pnpm etl export                # write data/public/<patch>/*.json (T-019)
pnpm etl backtest              # offline validation (T-027.a, T-027.b)
```

## Troubleshooting

- `better-sqlite3` install or load fails -> use Node 22 (prebuilt binaries; `better-sqlite3` 13.x requires Node >=22 and segfaults on Node 20, B-015); log anything new in BUGS.md.
- 401/403 from Riot -> key expired.
- 429 -> normal, the client waits for `Retry-After` and retries (up to 5 times).
- PowerShell script policy errors -> use `pnpm` commands only, avoid `.ps1` scripts.
