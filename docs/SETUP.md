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

1. Sign in at https://developer.riotgames.com, copy the Development API Key (expires every 24h) or your Personal key (no expiry — recommended).
2. Paste into `.env`. With a dev key, re-paste daily.
3. **Changing keys?** PUUIDs are encrypted per API key — run `pnpm etl rekey` (try `--dry-run` first) before the next `matches` run, then re-run `pnpm etl players` to repopulate pending players (B-062/D-060).

## Scheduled CI refresh (D-057)

`.github/workflows/etl.yml` runs the pipeline every 12h (and on demand via _Actions → ETL refresh → Run workflow_):

1. Restores `data/DraftOrb.sqlite` from the orphan branch `etl-db` (single gzipped file `DraftOrb.sqlite.gz`, ~58 MB, force-pushed/amended each run — the job refuses to run if the branch is missing, so an empty DB can never overwrite good state).
2. `migrate` → `check-key` → `static` → `matches euw1 --refresh` → `matches euw1 --limit 100` (bounded pending-player ingest) → `prune` → `aggregate` → `derive-roles` → `export` → `status`.
3. Checkpoints WAL + VACUUMs the DB, pushes the new state to `etl-db`, and commits changed `data/public/**` to `main`. Because `GITHUB_TOKEN` pushes do not trigger `push`-event workflows, the job then dispatches `deploy.yml` explicitly (`gh workflow run`).

Setup: add the **personal** Riot key as repo secret `RIOT_API_KEY` (Settings → Secrets and variables → Actions). `GITHUB_TOKEN` needs `contents: write` + `actions: write` (already granted by the workflow's `permissions` block).

To reseed `etl-db` from a local database:

```
sqlite3 data/DraftOrb.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
gzip -9 -c data/DraftOrb.sqlite > DraftOrb.sqlite.gz
# in a temp dir: git init -b etl-db, add the .gz, commit, push -u origin etl-db --force
```

Tuning: change the cron or the `--limit 100` pending-player cap in the workflow file; ingestion is resumable via cursors, so smaller caps just spread the work over more runs. Watch the gzipped size — GitHub rejects files >100 MB, so if `DraftOrb.sqlite.gz` approaches that, reduce `--per-player`/retention or move the state to external storage (see D-057).

## ETL commands

The database is `data/DraftOrb.sqlite` unless `DRAFTORB_DB_PATH` is set. `pnpm etl help` lists the commands and exit codes.

Implemented:

```
pnpm etl migrate [db-path]     # create/upgrade SQLite (also: pnpm migrate)
pnpm etl static [version]      # Data Dragon import -> data/public/<patch>/
pnpm etl validate-tags         # validate data/manual/champion-tags.json (also: pnpm validate:tags)
pnpm etl check-key [platform]  # test the Riot API key (default: euw1)
pnpm etl players [platform]    # discover players by tier (--tiers, --quota, --reset)
pnpm etl matches [platform]    # ingest matches, resumable, Ctrl+C safe (--since-patch, --per-player, --limit, --queue, --min-duration, --reset, --reset-tombstones, --refresh)
pnpm etl prune [--keep-patches=N] [--dry-run]  # delete matches older than the retention window and tombstone them as pruned (D-044; default keep: 20 patches)
pnpm etl status [platform]     # counts and progress
pnpm etl aggregate [patch]     # compute every aggregated table (role probabilities, baselines, pair and lane tables, rune contexts; T-015..T-018)
pnpm etl export [patch] [--region=<platform>]  # write versioned JSON and manifest for a patch (T-019)
pnpm etl derive-roles [patch]  # rewrite champions.json.roles from observed roles (T-015.b); run after `matches`, and re-run after every `static`
pnpm etl rekey [platform]      # rewrite stored PUUIDs to the current API key (after an RIOT_API_KEY change; --dry-run, --limit=N)
```

Database commands (`aggregate`, `derive-roles`, `export`, `status`, `matches`, `players`, `migrate`) resolve the SQLite path the same way (`DRAFTORB_DB_PATH` env or repo default). `aggregate` and `derive-roles` refuse to run on a database with pending migrations — run `pnpm etl migrate` first.

Planned (target state, see TICKETS.md):

```
pnpm etl backtest              # offline validation (T-027.a, T-027.b)
```

## Troubleshooting

- `better-sqlite3` install or load fails -> use Node 22 (prebuilt binaries; `better-sqlite3` 13.x requires Node >=22 and segfaults on Node 20, B-015); log anything new in BUGS.md.
- 401/403 from Riot -> key expired. `400 Exception decrypting <puuid>` -> the key changed since the DB was built; run `pnpm etl rekey` (B-062/D-060).
- 429 -> normal, the client waits for `Retry-After` and retries (up to 5 times).
- PowerShell script policy errors -> use `pnpm` commands only, avoid `.ps1` scripts.
