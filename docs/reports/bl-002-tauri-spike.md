# BL-002 — Windows 11 Tauri spike report (issue #68)

Date: 2026-11-16. Machine: owner's Windows 11 PC, MSVC toolchain (VS 2022 Community 14.44), Rust 1.100.0, Node 24.15.0, pnpm 12.15.0, Tauri 2.12.6 / wry 0.57.2 (WebView2 runtime 157.0.4341.46).

## What was built

`apps/desktop/` — a minimal Tauri v2 app:

- `src-tauri/` — Rust shell (~35 lines): one window, two commands (`process_uptime_ms`, `report_metrics`). No plugins, no capabilities, `bundle.active: false`.
- `ui/` — Vite + vanilla TypeScript frontend. Imports `@draftorb/engine` and `@draftorb/shared` from the workspace, validates `ui/src/fixture.json` (the `input` + `data` of the golden fixture `full_draft_support`) through the shared zod schemas, runs `recommend()` and renders the top 10 recommendations plus in-app timings.
- `scripts/bench.mjs` — Node benchmark: launches the release exe N times, waits for the metrics file the frontend writes through the shell, measures wall-clock cold start (spawn → first render write) and idle memory (`draftorb.exe` + its `msedgewebview2.exe` children, matched by command line).
- `scripts/gen-icon.mjs` — generates `src-tauri/icons/icon.ico` (required by tauri-build on Windows even without bundling).

Build: `pnpm --filter @draftorb/desktop build:ui && pnpm --filter @draftorb/desktop tauri build` → `src-tauri/target/release/draftorb.exe` (~9 MB). Frontend bundle: 128 kB JS (37.6 kB gzip) including engine + shared + zod + fixture.

## Measurements (5 cold runs, release build)

| Metric                                                                | Run values                                | Median           |
| --------------------------------------------------------------------- | ----------------------------------------- | ---------------- |
| External cold start (spawn → metrics file, i.e. content rendered)     | 505.4 / 338.3 / 322.7 / 334.7 / 344.2 ms  | **338 ms**       |
| Rust-side cold start → interactive (`process_uptime_ms` at render)    | 321.1 / 313.7 / 305.5 / 312.7 / 310.4 ms  | **313 ms**       |
| JS boot (process start → module eval)                                 | ~305–321 ms                               | ~311 ms          |
| `recommend()` latency, 200 iterations                                 | avg 0.077–0.092 ms, min 0 ms, max ≤1.6 ms | **0.081 ms avg** |
| Idle memory after 2 s (draftorb.exe + WebView2 children, 7 processes) | 349.0–353.5 MB                            | **351 MB**       |

First run of the day was the slowest (505 ms external); subsequent runs are consistent at ~320–345 ms.

## Proposed thresholds (for owner confirmation)

Starting estimates from AUDIT.md §6 were: cold start < ~3 s, idle memory < ~400 MB.

Measured values are ~10x under the start estimate and ~12% under the memory estimate **on a tiny fixture** (6 kB JSON, 3 recommendations). Real exported data is orders of magnitude larger, so proposed confirmation thresholds:

- Cold start to interactive: **< 1.5 s** on the real data bundle (current: 0.34 s with a trivial payload; headroom for data fetch/decode at launch per D-099).
- `recommend()` latency: **< 5 ms** per call on real data (current: 0.08 ms on the fixture; the engine indexes tables per call, so this must be re-measured with real `RecommendData` in BL-010+).
- Idle memory: **< 450 MB** total including WebView2 (current: 351 MB; WebView2 dominates and grows with DOM size).

## GO/NO-GO recommendation for D-115

**GO** — TypeScript engine + Tauri shell is viable on Windows 11:

- Startup is far inside budget (~0.34 s vs 3 s estimate) even before data download exists.
- The pure-TS engine runs unchanged inside the WebView2 webview; no Rust port needed for v1.
- Memory is within budget (~351 MB vs 400 MB estimate).
- Toolchain cost is real but one-time: Rust 1.100 + VS 2022 Build Tools required on any machine that compiles the shell (CI Windows runner already exists per AUDIT §5j).

Caveats / follow-ups:

- **Fixture is tiny.** Re-run `bench.mjs` with real `data/public/<patch>/` exports once BL-004/BL-010 land; engine latency and parse time will grow with table size.
- **`cargo build` alone produces a dev-mode app** (loads `devUrl`, shows ERR_CONNECTION_REFUSED without a dev server). Production binary requires `pnpm tauri build` — document this in SETUP.md when the app becomes real (BL-010a).
- **Bundling is off** (`bundle.active: false`): no installer/MSI yet — that is BL-025 (CI artifact).
- WebView2 memory is shared-ish: the 351 MB counts only processes whose command line references the app identifier; other Edge/WebView2 usage on the machine is excluded.
- `withGlobalTauri` is enabled for the spike; the real app should use `@tauri-apps/api` imports instead (dependency note in DECISIONS.md D-116).

## Owner confirmation

- Thresholds confirmed / adjusted: ____________________
- GO / NO-GO for D-115: ____________________
