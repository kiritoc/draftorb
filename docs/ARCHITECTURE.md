# ARCHITECTURE

## Overview
```
 Riot API ──> packages/etl ──> SQLite (local, gitignored)
                                  │ aggregate
                                  ▼
                        data/public/<patch>/*.json  (committed or published)
                                  │
              ┌───────────────────┴──────────────────┐
              ▼                                      ▼
        apps/web (static)                      apps/desktop (Electron)
              └──────────── packages/engine (pure) ───────────┘
                           packages/shared (types/zod)
```
- ETL runs on the owner's PC (or a GitHub Action later). Output = versioned JSON.
- Engine runs client-side (browser/Electron). No backend.

## Packages
| Package | Responsibilities | Forbidden |
|---|---|---|
| shared | Types, zod schemas, enums, constants | Logic with side effects |
| engine | rank weighting, shrinkage, role inference, scoring, runes/items recommendation | DOM, fs, network, Node APIs |
| etl | Riot client, rate limiter, SQLite, ingestion, aggregation, JSON export, Data Dragon import | UI code |
| web | React UI, data loading (fetch JSON), state | Business logic (call engine) |
| desktop | Electron main/preload, LCU/Live adapters, capture, overlay | Business logic |

## Stack
Node 20+, pnpm, TypeScript strict, Vite, React, Tailwind, Zod, Vitest, ESLint+Prettier, better-sqlite3, Electron (phase 2), opencv.js / tesseract.js / onnxruntime (vision, phase 2).

## Data flow (draft)
1. Web loads `manifest.json` (patch, files, generatedAt).
2. Loads static data (champions, tags) + support tables for selected rank bucket.
3. User input -> `engine.recommend(draftInput, dataBundle)` -> `Recommendation[]` -> UI cards.

## Data versioning
`data/public/<patch>/` + `data/public/manifest.json` (latest). Engine functions receive data as arguments (dependency injection) — never import JSON directly.

## Adapters pattern (phase 2)
`DraftSource` interface: `manual | lcu | vision` each emitting `DraftInput`. `GameStateSource`: `manual | liveClient | vision` each emitting `GameState`. UI and engine do not know the source.

## Error handling
Engine returns typed results (`Result`/explicit `lowData` flags), never throws on user input. ETL is resumable and idempotent.
