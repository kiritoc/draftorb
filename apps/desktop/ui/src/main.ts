import './style.css';

import { recommend } from '@draftorb/engine';
import { draftInputSchema, recommendDataSchema } from '@draftorb/shared';
import type { DraftInput, RecommendData, DraftResult } from '@draftorb/shared';

import fixtureJson from './fixture.json';

interface SpikeMetrics {
  /** Wall time from process start (Rust main) to first render, reported by the shell. */
  coldStartToInteractiveMs: number;
  /** Wall time from process start to JS module evaluation start. */
  jsBootMs: number;
  schemaParseMs: number;
  engineCallAvgMs: number;
  engineCallMinMs: number;
  engineCallMaxMs: number;
  engineIterations: number;
  recommendationCount: number;
  topChampionIds: number[];
  schemaVersion: number;
}

interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

declare global {
  interface Window {
    __SPIKE_METRICS__?: SpikeMetrics;
  }
}

const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
// In a plain browser (vite dev) there is no shell: metrics degrade to NaN.
const invoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  tauri ? tauri.core.invoke<T>(cmd, args) : Promise.resolve(NaN as T);

async function main(): Promise<void> {
  const t0 = performance.now();
  // Elapsed since process start, sampled as early as JS can run.
  const jsBootPromise = invoke<number>('process_uptime_ms').catch(() => NaN);

  const input: DraftInput = draftInputSchema.parse(fixtureJson.input);
  const data: RecommendData = recommendDataSchema.parse(fixtureJson.data);
  const schemaParseMs = performance.now() - t0;

  // One real recommend() call, then a loop for a stable latency number.
  const ENGINE_ITERATIONS = 200;
  const timings: number[] = [];
  let result: DraftResult | undefined;
  for (let i = 0; i < ENGINE_ITERATIONS; i++) {
    const start = performance.now();
    result = recommend(input, data);
    timings.push(performance.now() - start);
  }
  if (!result) throw new Error('recommend() did not run');

  const engineCallAvgMs = timings.reduce((a, b) => a + b, 0) / timings.length;
  const engineCallMinMs = Math.min(...timings);
  const engineCallMaxMs = Math.max(...timings);

  const top = result.recommendations.slice(0, 10);
  const app = document.getElementById('app');
  if (!app) throw new Error('missing #app');

  const list = top
    .map(
      (r) =>
        `<li><strong>#${r.rank}</strong> champion ${r.championId} — score ${r.score.toFixed(4)} ` +
        `<small>nEff ${r.reliability.nEff.toFixed(1)}${r.reliability.lowData ? ' (low data)' : ''}</small></li>`,
    )
    .join('');

  app.innerHTML = `
    <h1>DraftOrb spike — recommend() output</h1>
    <p class="meta">Fixture: full draft, SUPPORT, DIAMOND. ${result.recommendations.length} recommendations.</p>
    <ol>${list}</ol>
    <table id="metrics">
      <tr><td>schema parse</td><td>${schemaParseMs.toFixed(2)} ms</td></tr>
      <tr><td>engine call avg / min / max</td><td>${engineCallAvgMs.toFixed(3)} / ${engineCallMinMs.toFixed(3)} / ${engineCallMaxMs.toFixed(3)} ms (${ENGINE_ITERATIONS} iters)</td></tr>
    </table>
  `;

  // Wait for an actual paint (two animation frames) so the cold-start number
  // marks visible content, not just DOM readiness.
  await new Promise<void>((resolvePaint) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolvePaint()));
  });

  // Cold-start numbers as seen by the Rust process: JS boot time and the
  // wall-clock time until this content is painted.
  const [jsBootMs, interactiveMs] = await Promise.all([
    jsBootPromise,
    invoke<number>('process_uptime_ms').catch(() => NaN),
  ]);

  const metrics: SpikeMetrics = {
    coldStartToInteractiveMs: interactiveMs,
    jsBootMs,
    schemaParseMs,
    engineCallAvgMs,
    engineCallMinMs,
    engineCallMaxMs,
    engineIterations: ENGINE_ITERATIONS,
    recommendationCount: result.recommendations.length,
    topChampionIds: top.map((r) => r.championId),
    schemaVersion: result.schemaVersion,
  };

  // Hand the metrics to the shell, which writes them to a temp file for the
  // external benchmark script.
  await invoke('report_metrics', { payload: JSON.stringify(metrics) }).catch(() => {});
  window.__SPIKE_METRICS__ = metrics;
  document.title = 'DraftOrb Spike READY';
}

void main();
