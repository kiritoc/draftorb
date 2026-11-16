#!/usr/bin/env node
/**
 * BL-002 spike benchmark: cold start, engine latency, idle memory.
 *
 * Usage: pnpm --filter @draftorb/desktop bench [-- --runs 5] [--exe <path>]
 *
 * For each run it launches the built Tauri exe, waits for the frontend to
 * write %TEMP%/draftorb-spike-metrics.json (written right after first
 * render), measures wall-clock cold start from spawn to that write, then
 * samples idle memory of draftorb.exe plus its WebView2 child processes.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const RUNS = Number(opt('--runs', '5'));
const repoRoot = resolve(
  new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  '..',
  '..',
);
const defaultExe = join(
  repoRoot,
  'apps',
  'desktop',
  'src-tauri',
  'target',
  process.env.BENCH_PROFILE === 'debug' ? 'debug' : 'release',
  'draftorb.exe',
);
const EXE = resolve(opt('--exe', defaultExe));
const METRICS_FILE = join(tmpdir(), 'draftorb-spike-metrics.json');
const IDENTIFIER = 'draftorb';

if (!existsSync(EXE)) {
  console.error(`Executable not found: ${EXE}`);
  console.error(
    'Build first: pnpm --filter @draftorb/desktop build:ui && cargo build --release --manifest-path apps/desktop/src-tauri/Cargo.toml',
  );
  process.exit(1);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

interface MemorySample {
  totalMB: number | null;
  count: number;
  error?: string;
}

function sampleMemoryMB(): MemorySample {
  // Sum WorkingSetSize of draftorb.exe and msedgewebview2.exe processes whose
  // command line references this app's identifier (its WebView2 user-data dir).
  const ps = `
$procs = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'draftorb.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*${IDENTIFIER}*') } |
  Select-Object ProcessId, Name, WorkingSetSize
$sum = ($procs | Measure-Object WorkingSetSize -Sum).Sum
[pscustomobject]@{ totalMB = [math]::Round($sum / 1MB, 1); count = @($procs).Count; names = ($procs | ForEach-Object Name | Sort-Object -Unique) -join ',' } | ConvertTo-Json -Compress
`;
  const out = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (out.status !== 0) return { totalMB: null, count: 0, error: out.stderr.trim() };
  try {
    return JSON.parse(out.stdout.trim()) as MemorySample;
  } catch {
    return { totalMB: null, count: 0, error: out.stdout.trim() };
  }
}

interface SpikeMetricsFile {
  coldStartToInteractiveMs?: number;
  jsBootMs?: number;
  engineCallAvgMs?: number;
  engineCallMinMs?: number;
  engineCallMaxMs?: number;
  engineIterations?: number;
  recommendationCount?: number;
}

async function waitForMetrics(timeoutMs: number): Promise<SpikeMetricsFile | null> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (existsSync(METRICS_FILE) && Date.now() - statSync(METRICS_FILE).mtimeMs < timeoutMs) {
      try {
        return JSON.parse(readFileSync(METRICS_FILE, 'utf8')) as SpikeMetricsFile;
      } catch {
        // partially written; retry
      }
    }
    await sleep(25);
  }
  return null;
}

interface RunResult {
  run: number;
  externalColdStartMs: number | null;
  rustColdStartToInteractiveMs: number | null;
  jsBootMs: number | null;
  engineCallAvgMs: number | null;
  engineCallMinMs: number | null;
  engineCallMaxMs: number | null;
  engineIterations: number | null;
  recommendationCount: number | null;
  idleMemoryMB: number | null;
  memoryProcessCount: number;
}

const runs: RunResult[] = [];
for (let i = 0; i < RUNS; i++) {
  rmSync(METRICS_FILE, { force: true });
  killTreeByName();
  await sleep(300);

  const t0 = performance.now();
  const child = spawn(EXE, [], { stdio: 'ignore', windowsHide: false });
  const metrics = await waitForMetrics(20000);
  const externalColdStartMs = metrics ? performance.now() - t0 : null;

  // Let the app sit idle, then sample memory.
  await sleep(2000);
  const memory = sampleMemoryMB();
  killTree(child.pid);
  await sleep(300);

  runs.push({
    run: i + 1,
    externalColdStartMs:
      externalColdStartMs === null ? null : Math.round(externalColdStartMs * 10) / 10,
    rustColdStartToInteractiveMs:
      metrics && Number.isFinite(metrics.coldStartToInteractiveMs)
        ? Math.round((metrics.coldStartToInteractiveMs ?? 0) * 10) / 10
        : null,
    jsBootMs:
      metrics && Number.isFinite(metrics.jsBootMs)
        ? Math.round((metrics.jsBootMs ?? 0) * 10) / 10
        : null,
    engineCallAvgMs:
      metrics && Number.isFinite(metrics.engineCallAvgMs)
        ? Math.round((metrics.engineCallAvgMs ?? 0) * 1000) / 1000
        : null,
    engineCallMinMs:
      metrics && Number.isFinite(metrics.engineCallMinMs)
        ? Math.round((metrics.engineCallMinMs ?? 0) * 1000) / 1000
        : null,
    engineCallMaxMs:
      metrics && Number.isFinite(metrics.engineCallMaxMs)
        ? Math.round((metrics.engineCallMaxMs ?? 0) * 1000) / 1000
        : null,
    engineIterations: metrics?.engineIterations ?? null,
    recommendationCount: metrics?.recommendationCount ?? null,
    idleMemoryMB: memory.totalMB,
    memoryProcessCount: memory.count,
  });
}

function killTreeByName() {
  spawnSync('taskkill', ['/IM', 'draftorb.exe', '/T', '/F'], { stdio: 'ignore' });
}

const median = (xs: Array<number | null>): number | null => {
  const s = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] ?? null) : null;
};

const summary = {
  exe: EXE,
  runs,
  median: {
    externalColdStartMs: median(runs.map((r) => r.externalColdStartMs)),
    rustColdStartToInteractiveMs: median(runs.map((r) => r.rustColdStartToInteractiveMs)),
    engineCallAvgMs: median(runs.map((r) => r.engineCallAvgMs)),
    idleMemoryMB: median(runs.map((r) => r.idleMemoryMB)),
  },
};

console.log(JSON.stringify(summary, null, 2));
