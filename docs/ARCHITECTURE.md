# ARCHITECTURE

Status (2026-11-04): `packages/shared` (types + zod schemas), `packages/engine` (role-generic recommendation engine) and `packages/etl` (Riot client, SQLite ingestion, aggregation, JSON export) exist. `apps/web` is a scaffold (stub app, T-030 not started); `apps/desktop` is not created.

Update (2026-11-08, D-078/D-079): the app is **local-only** — no hosting, no deploy workflow. ETL state lives in release assets of a private repo; `data/public` is gitignored and reaches the app via `pnpm etl pull`.

## Overview

```
 Riot API ──> packages/etl ──> SQLite (local, gitignored; CI state = release assets of private repo `draftorb-state`)
                                  │ aggregate + profile-sync export
                                  ▼
                        data/public/<patch>/*.json  (gitignored; packed into public-exports.tar.gz)
                        data/public/profiles/*.json (pipeline-synced configured profiles)
                                  │ pnpm etl pull (gh CLI)
              ┌───────────────────┴──────────────────┐
              ▼                                      ▼
        apps/web (local static app)            apps/desktop (Electron, phase 2)
              └──────────── packages/engine (pure) ───────────┘
                           packages/shared (types/zod)
```

- ETL runs on the owner's PC and in the scheduled GitHub Action `etl.yml` (D-057/D-070/D-078). Output = versioned JSON served locally. No backend, no login, no sessions, no hosting (D-067, D-079).
- Engine runs client-side (browser/Electron). No backend. The app never calls Riot; profile data arrives as static JSON (D-068).
- Personalization + state pipeline (D-067..D-070, D-078, D-079):

```
GitHub Secrets (RIOT_API_KEY)          data/profiles.config.json (committed, no secrets)
        │                                            │
        ▼                                            ▼
  etl.yml (schedule + dispatch) ──> pnpm etl profile-sync
        │                              account-v1 -> puuid -> match-v5 (queue 420,
        │                              incremental cursor) + champion-mastery-v4
        │                                            │
        │                              SQLite: profiles / profile_games / profile_mastery
        │                                            │ anonymized export (D-069)
        ▼                                            ▼
  state-* release assets ◄────────── data/public/profiles/<id>.json + index.json
  (private repo draftorb-state:               │ packed into public-exports.tar.gz
   DraftOrb.sqlite.gz + exports)              │
        │                                     ▼
        │                              pnpm etl pull -> data/public
        ▼                                            ▼
  next run restores newest release      local app: browser loads profile JSON,
                                        runs engine.personalize(...)
                                        pool + favorites toggle stay in localStorage (D-024/D-074)
```

## Packages

| Package | Responsibilities                                                                           | Forbidden                    |
| ------- | ------------------------------------------------------------------------------------------ | ---------------------------- |
| shared  | Types, zod schemas, enums, constants                                                       | Logic with side effects      |
| engine  | rank weighting, shrinkage, role inference, scoring, runes/items recommendation             | DOM, fs, network, Node APIs  |
| etl     | Riot client, rate limiter, SQLite, ingestion, aggregation, JSON export, Data Dragon import | UI code                      |
| web     | React UI, data loading (fetch JSON), state                                                 | Business logic (call engine) |
| desktop | Electron main/preload, LCU/Live adapters, capture, overlay                                 | Business logic               |

## Stack

Node 22 (CI and minimum, enforced by `engines` and CI matrix; Node 20 unsupported — see B-015), pnpm, TypeScript strict, Vite, React, Tailwind, Zod, Vitest, ESLint+Prettier, better-sqlite3, Electron (phase 2), opencv.js / tesseract.js / onnxruntime (vision, phase 2).

## Data flow (draft)

1. `pnpm etl pull` refreshes `data/public` from the newest state release (D-079); locally generated exports work the same way.
2. Web loads `data/public/latest.json` to learn the current patch, then `<patch>/manifest.json` (patch, files, generatedAt) (D-051, T-029; `latest.json` is not yet written by export).
3. Loads static data (champions, tags) + the role tables listed in `manifest.roles` (`roles/<ROLE>/...`, DATA_MODEL.md), plus `data/public/profiles/index.json` and the configured profile's JSON when present (D-068, SPECS §18).
4. User input -> `engine.recommend(draftInput, dataBundle)` -> `DraftResult` (SPECS §7) -> UI lists; when a profile is loaded, `engine.personalize(...)` produces the separate profile-labeled list (SPECS §18, `score(c)` unchanged).

## Data versioning

`data/public/<patch>/` + `data/public/latest.json` pointing at the current patch's `manifest.json` (D-051, T-029; not yet written by export). `data/public` is gitignored and distributed via the state release's `public-exports.tar.gz` asset (D-078/D-079). Engine functions receive data as arguments (dependency injection) — never import JSON directly.

## Adapters pattern (phase 2)

`DraftSource` interface: `manual | lcu | vision` each emitting `DraftInput`. `GameStateSource`: `manual | liveClient | vision` each emitting `GameState`. UI and engine do not know the source.

## Error handling

Engine returns typed results (`Result`/explicit `lowData` flags), never throws on user input. ETL is resumable and idempotent.
