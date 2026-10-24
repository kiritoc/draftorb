# SETUP (Windows, minimal)

## Prerequisites

1. **Node.js 20 LTS+** (https://nodejs.org) — includes npm.
2. **pnpm**: in PowerShell `corepack enable` then `corepack prepare pnpm@latest --activate` (or `npm i -g pnpm`).
3. **Git**.
4. (Optional) VS Code. No Python, no Java, no Docker, no compiler needed.

## First run

```
git clone <repo> && cd DraftOrb
pnpm install
copy .env.example .env      # then edit RIOT_API_KEY
pnpm test
pnpm dev
```

## Riot key

1. Sign in at https://developer.riotgames.com, copy the Development API Key (expires every 24h).
2. Paste into `.env`. Re-paste daily until a production key is approved.

## ETL commands (target state — implemented by tickets)

```
pnpm etl migrate            # create/upgrade SQLite
pnpm etl static             # Data Dragon import
pnpm etl players            # discover players by tier
pnpm etl matches            # ingest matches (resumable, Ctrl+C safe)
pnpm etl aggregate          # compute tables
pnpm etl export             # write data/public/<patch>/*.json
pnpm etl status             # counts and progress
```

## Troubleshooting

- `better-sqlite3` install fails -> make sure Node 20 LTS (prebuilt binaries); log in BUGS.md.
- 401/403 from Riot -> key expired.
- 429 -> normal, the client waits; lower concurrency in config if frequent.
- PowerShell script policy errors -> use `pnpm` commands only, avoid `.ps1` scripts.
