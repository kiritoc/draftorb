# SHARING — run DraftOrb with your own data

How a second player installs the program and points it at **their own** pool and
profile. The code and the public aggregates are shareable; your profile data is
not (see "Privacy boundary" below).

## Privacy boundary (read first)

- **Shareable:** the source code and the public aggregate statistics. The
  desktop app downloads them at launch from a public release asset — no Riot
  key, no token, nothing to configure.
- **Not shareable:** your profile export, your PUUIDs, match ids, Riot IDs and
  the SQLite database. They stay on your machine:
  - `data/public/` and `data/users/` are gitignored — never commit them.
  - `data/DraftOrb.sqlite` (and `data/raw/`) are gitignored — never commit or
    share them.
  - `data/pool.config.json` is the exception: it is **meant to be committed**,
    but it must contain champion ids and optional champion names only — no
    PUUIDs, Riot IDs, match ids, player names or game timestamps. The
    repository is public, so your pool list becomes public if you commit it.
- The program itself stores **no Riot token** and never calls Riot. It only
  reads files you produce locally with the ETL commands.

## What you need

- Node.js 22+ and pnpm (see `docs/SETUP.md` > Prerequisites).
- Git.
- The Rust toolchain (rustup; MSVC build tools on Windows) — only for the
  desktop app.
- A free Riot Games API key from https://developer.riotgames.com — **only** if
  you want the personal-record badge. Get it, paste it into `.env`, never
  commit `.env`.

## Install

```
git clone <this repo>
cd DraftOrb
pnpm install
copy .env.example .env        # Windows; on macOS/Linux: cp .env.example .env
# edit .env and set RIOT_API_KEY to YOUR key
pnpm --filter @draftorb/desktop tauri dev     # run with hot reload
```

For a production binary: `pnpm --filter @draftorb/desktop tauri build --no-bundle`
(see `docs/SETUP.md` > "Desktop app (dev)"). A prebuilt unsigned NSIS
installer is also published on the GitHub releases page (BL-025) — see
`docs/SETUP.md` > "Installing the Windows app" for the SmartScreen warning and
install steps. Building from source remains the path when you need your own
local changes.

The first launch downloads the public aggregates by itself — the pick screen
works with **no Riot key at all**. The key is only needed for your personal
record (below).

## First run — replace the example data with yours

The repository ships an example profile config (`data/profiles.config.json`)
describing the original owner's account, and a pool file
(`data/pool.config.json`) may exist describing their champion pool. **Before
using the app, replace both with your own:**

1. `data/profiles.config.json` — committed, describes whose match history the
   ETL syncs. Replace the entry with your own Riot ID.
2. `data/pool.config.json` — the repo copy of a champion pool. Replace it with
   yours, or delete it and export your own from the app (see below).
3. Profile exports — `data/public/profiles/` and `data/users/profiles/`. Both
   are gitignored, so a fresh clone cannot contain them; if you reuse an
   existing clone, delete them before syncing your own (see below).

Skipping this means the pipeline would sync someone else's profile and the
repo file would describe someone else's pool.

## Your champion pool

The pool is **champion x roles** (e.g. Shen on Top and Jungle). Two places hold
it:

- **In the app (source of truth for the pick screen):** open the pool editor,
  add champions and tick the roles for each. The program stores the pool in
  its own config directory.
- **`data/pool.config.json` (repo copy):** a portable backup/sync of your
  pool between machines.
  - Prerequisite: set **Settings → Repo folder** to your clone first; the
    repo file actions stay hidden until it is set.
  - To write it from the app: save your pool edits first (export is refused
    while there are unsaved changes), then pool editor → **Export to repo file**. The
    program writes `<your clone>/data/pool.config.json`; review it before
    committing it (the repository is public).
  - To load it into the app: pool editor → **Import from repo file**.
  - If the two differ, the app shows a warning banner; nothing is overwritten
    automatically.

The pool never changes recommendation scores — it only highlights and groups
champions ("From your pool" / "In pool" tags).

## Your profile (personal record badge)

The badge on each recommendation card shows **your** record for that
champion and role. It is fed by an anonymized export the ETL produces locally.

1. In your clone, replace `data/profiles.config.json` with your own entry:

   ```json
   {
     "schemaVersion": 1,
     "profiles": [
       {
         "id": "yourname-euw1",
         "riotId": { "gameName": "YourName", "tagLine": "TAG" },
         "platform": "EUW1",
         "label": "Your picks",
         "options": {}
       }
     ]
   }
   ```

   - `id`: lowercase slug, used for the export file name.
   - `riotId`: your League of Legends name + tagline — for `YourName#TAG`,
     `gameName: "YourName"`, `tagLine: "TAG"` (the part after `#`; it is **not**
     your platform code).
   - `platform`: your Riot platform (`EUW1`, `EUN1`, `NA1`, ...).
   - `label`: free text shown in the UI.

2. Sync your profile (uses `RIOT_API_KEY` from `.env`; creates and migrates
   the local SQLite database itself — no state repo needed):

   ```
   pnpm etl profile-sync --publish
   ```

   `--publish` writes `data/public/profiles/index.json` and `<id>.json` —
   the folder the program reads. Without `--publish` the export goes to
   `data/users/profiles/` instead, which the app does **not** read. Both
   folders are gitignored, so your data never leaves your machine.

3. In the app, open **Settings** and set **Repo folder** to the root of your
   local clone (the folder that contains `data/`). If you already set it
   earlier (for example for the pool file), skip this step.

4. (Re)start the app — the profile export is only read at launch or when
   Repo folder changes, so a sync run while the app was already open is not
   picked up. Champion cards now show your record badge. To refresh later,
   re-run `pnpm etl profile-sync --publish` and restart the app again.

If the profile file is missing or invalid, the badge simply shows **"no data"**
and everything else keeps working — no crash, no warning noise. A notice in
Settings names the file and the reason when a file exists but fails
validation.

## Running your own data pipeline (optional)

You can run the ETL pipeline yourself (`pnpm etl ...`, see
`docs/SETUP.md` > "ETL commands"). Notes:

- The desktop app does **not** read locally generated aggregates: at launch
  it always uses the public release download (or its cached copy). Local
  aggregates are for development and inspection only.
- The scheduled ingest does not read `data/pool.config.json` today; committing
  a pool does not change what it collects.
- You do not need access to anyone else's state repository; `pnpm etl migrate`
  creates a fresh local database and each command is resumable.
- `pnpm etl pull` and the owner's state release are private infrastructure —
  ignore them unless you set up your own.

## Troubleshooting

- Badge shows "no data": Repo folder unset, `data/public/profiles/` missing,
  or `profile-sync` never ran with `--publish`. Check Settings for the named
  file and reason.
- Pool file actions disabled in the pool editor: Repo folder is unset or does
  not point at a DraftOrb clone (a folder containing `data/`).
- 401/403 from Riot during `profile-sync`: key missing/expired in `.env` —
  see `docs/SETUP.md` > "Riot key".
- Everything else: `docs/SETUP.md` > "Troubleshooting".
