# SETUP (Windows, minimal)

## Prerequisites

1. **Node.js 22** (https://nodejs.org) — the version CI tests and the minimum supported version. Node 20 is no longer supported: `better-sqlite3` 13.x requires Node >=22 and segfaults on Node 20 (B-015).
2. **pnpm**: in PowerShell `corepack enable`; Corepack then uses the pnpm version pinned in `package.json` (`packageManager`). Alternative: `npm i -g pnpm`.
3. **Git** and the **GitHub CLI (`gh`)** — needed for `pnpm etl pull` and for seeding the state release.
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

The app is **local-only** (D-079): there is no hosting and no deploy workflow. `data/public` is gitignored; get the current exports with `pnpm etl pull` (downloads the newest state release — see "State repo and token" below) or generate them locally with `pnpm etl static` / `pnpm etl export`.

## Riot key

1. Sign in at https://developer.riotgames.com, copy the Development API Key (expires every 24h) or your Personal key (no expiry — recommended).
2. Paste into `.env`. With a dev key, re-paste daily.
3. **Changing keys?** PUUIDs are encrypted per API key — run `pnpm etl rekey` (try `--dry-run` first) before the next `matches` run, then re-run `pnpm etl players` to repopulate pending players (B-062/D-060). Because the scheduled workflow restores its database from the latest state release, a key change also requires re-keying that stored database — see "Riot key rotation" below.

## State repo and token (D-078)

The scheduled ETL persists its SQLite database and the `data/public` exports as assets of **releases** in a private GitHub repo — default name `draftorb-state`, no workflows inside. Each run publishes a release tagged `state-<UTC yyyymmddThhmmZ>` with two assets:

- `DraftOrb.sqlite.gz` — the gzipped database (~58 MB today);
- `public-exports.tar.gz` — the contents of `data/public` (only uploaded when the pipeline succeeded).

Auth uses a **fine-grained personal access token** limited to that one repo with **Contents: read/write**, stored as the Actions secret `STATE_REPO_TOKEN` (Settings → Secrets and variables → Actions). `GITHUB_TOKEN` cannot reach another repo. Tokens expire (at most one year): record the expiry date here when the token is created — **expiry: \____-**-** (to verify at creation)** — and rotate before it lapses; the workflow fails early with a clear message if the token is rejected.

A run downloads the newest `state-*` release and **fails if none exists** (an empty DB can never overwrite good state). Keep a local copy of the database: if the state repo is deleted, state is lost.

## Seeding the first state release

From a local checkout with the database at `data/DraftOrb.sqlite`:

```
sqlite3 data/DraftOrb.sqlite "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA integrity_check;"
# integrity_check must print "ok"; stop otherwise
sqlite3 data/DraftOrb.sqlite "VACUUM;"
gzip -9 -c data/DraftOrb.sqlite > DraftOrb.sqlite.gz
tar -czf public-exports.tar.gz -C data public
gh release create state-$(date -u +%Y%m%dT%H%MZ) DraftOrb.sqlite.gz public-exports.tar.gz --repo <owner>/draftorb-state
```

(Adjust `tar`/`gzip`/`date` for your platform — Git Bash or WSL on Windows.) Then verify: download the release assets again and check the gzip integrity and that `public-exports.tar.gz` extracts the expected `data/public` tree.

## Scheduled ETL workflow (D-057, D-078, D-079)

`.github/workflows/etl.yml` runs the pipeline every 12h (and on demand via _Actions → ETL refresh → Run workflow_; `workflow_dispatch` is also how the migration is verified — run it twice):

1. Downloads the newest `state-*` release from the state repo and restores `data/DraftOrb.sqlite` (fails early if there is no release or the token is rejected).
2. `migrate` → `check-key` → `static` → `matches euw1 --refresh` → `matches euw1 --limit 100` (bounded pending-player ingest) → `profile-sync --publish` (configured profiles only, non-fatal) → `prune` → `aggregate` → `derive-roles` → `export` → `status`.
3. `wal_checkpoint(TRUNCATE)` → `PRAGMA integrity_check` must return `ok` (otherwise nothing is uploaded) → `VACUUM` → gzip → uploads `DraftOrb.sqlite.gz` with `if: always()` so partial progress (cursors, stored matches) is saved even when a step fails; `public-exports.tar.gz` is uploaded only on success. After a successful upload the workflow prunes to the newest 7 `state-*` releases.
4. It no longer commits `data/public` to `main` and no longer dispatches a deploy workflow — the app is local-only (D-079).

`pnpm etl pull` downloads the newest state release and extracts `public-exports.tar.gz` into `data/public` (uses the `gh` CLI, no new dependency). Re-run it whenever you want fresh data locally.

## Migrating off `etl-db` (D-078 point 8)

The old orphan branch `etl-db` on the public repo held the same gzipped database where anyone could download it. After **two consecutive successful** `workflow_dispatch` runs on the new flow (new release created, `integrity_check` ok, restore from an older release verified, `pnpm etl pull` + the local app working), delete the branch:

```
git push origin --delete etl-db
```

GitHub may keep serving the old commits by SHA for some time — **to verify**; if that matters, ask GitHub support to purge them.

## Log hygiene (D-078 point 9)

The main repo is public, so **workflow logs are public** and secret masking does not cover other players' data. No step may print other players' Riot IDs, puuids or match ids, nor the profile owner's raw game data. `pnpm etl status` counts are fine; per-player dumps are not.

## Reminders

- **Token expiry**: fine-grained tokens expire at most one year — rotate `STATE_REPO_TOKEN` before the recorded expiry date.
- **Scheduled-workflow keepalive**: GitHub may disable scheduled workflows in a public repo after ~60 days without repo activity (**to verify**). Set a reminder to touch the repo (or run `workflow_dispatch`) about every 50 days, or add a keepalive step (ticket).

## Profile sync (D-067..D-071, D-078, D-079)

Personalization is fed by configured profiles declared in `data/profiles.config.json` (committed, no secrets). Default and only entry: `KiriToc#Toc` on `EUW1`. Only configured profiles are ever synced — visitors cannot add any, and adding another person's profile requires their consent.

- Local: `pnpm etl profile-sync [profileId] [--publish]` uses `RIOT_API_KEY` from `.env` (same key as the other ETL commands; see "Riot key" above — a dev key expires every 24 h and cannot drive the schedule, use the personal key).
- CI: `etl.yml` runs `profile-sync` for every configured profile on each scheduled run and on `workflow_dispatch`, using the `RIOT_API_KEY` GitHub Actions secret. Profile tables live in the same database persisted in the state releases (D-078).
- Exports land in `data/public/profiles/` (`<id>.json` + `index.json`), anonymized per D-069; `data/public` is gitignored, so they are packed into `public-exports.tar.gz` and reach the local app via `pnpm etl pull`.
- Key rotation: if `RIOT_API_KEY` ever changes, stored profile puuids are encrypted per key like match puuids (B-062/D-060) — re-resolve/re-key before the next sync (procedure in D-071, implementation detail in T-091/T-111).
- Secret-leak check (T-092): `node scripts/check-secrets.mjs` scans committed files (`git ls-files`) and `apps/web/dist` for `RGAPI-` tokens and the literal `RIOT_API_KEY` value (when set). It runs in CI (`ci.yml` lint job); scanning `data/public` before it is packed into the release is planned (ticket). It reports file + needle name only, never the secret. Run it locally any time with `node scripts/check-secrets.mjs`.

## Riot key rotation (D-071)

If `RIOT_API_KEY` ever changes (personal key rotated, dev key swapped, etc.):

1. Update the GitHub Actions secret `RIOT_API_KEY` and the local `.env`.
2. Run `pnpm etl check-key` to confirm the new key works.
3. PUUIDs are encrypted per key: run `pnpm etl rekey` (`--dry-run` first) on the local database, then re-run `pnpm etl players` to repopulate pending players (B-062/D-060). Profile puuids need the same treatment (open question, D-071 — tracked in T-111).
4. The scheduled workflow restores its database from the **latest state release**, which still holds puuids encrypted under the old key — download that release's DB (or use your rekeyed local DB), apply `rekey`, and publish a fresh `state-*` release (same procedure as "Seeding the first state release") so the next run starts from re-keyed data.
5. The next scheduled run resumes normally from cursors.

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
pnpm etl profile-sync [id]     # sync configured profiles -> SQLite -> data/public/profiles/ (T-091, D-068)
```

Database commands (`aggregate`, `derive-roles`, `export`, `status`, `matches`, `players`, `migrate`) resolve the SQLite path the same way (`DRAFTORB_DB_PATH` env or repo default). `aggregate` and `derive-roles` refuse to run on a database with pending migrations — run `pnpm etl migrate` first.

Planned (target state, see TICKETS.md):

```
pnpm etl backtest              # offline validation (T-027.a, T-027.b)
pnpm etl pull                  # download newest state-* release exports into data/public (T-108, D-079)
```

## Troubleshooting

- `better-sqlite3` install or load fails -> use Node 22 (prebuilt binaries; `better-sqlite3` 13.x requires Node >=22 and segfaults on Node 20, B-015); log anything new in BUGS.md.
- 401/403 from Riot -> key expired. `400 Exception decrypting <puuid>` -> the key changed since the DB was built; run `pnpm etl rekey` (B-062/D-060).
- `pnpm etl pull` / workflow fails with an auth error -> `STATE_REPO_TOKEN` missing, expired or lacks Contents read/write on the state repo (D-078).
- 429 -> normal, the client waits for `Retry-After` and retries (up to 5 times).
- PowerShell script policy errors -> use `pnpm` commands only, avoid `.ps1` scripts.
