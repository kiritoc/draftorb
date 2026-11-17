import { invokeCommand, isTauri } from './tauri';

/** Reports cold-start figures after the first paint; `scripts/bench.ts` reads them. */
export async function reportFirstPaint(jsBootMs: Promise<number>): Promise<void> {
  if (!isTauri()) return;
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
  const [jsBoot, interactive] = await Promise.all([
    jsBootMs,
    invokeCommand<number>('process_uptime_ms').catch(() => NaN),
  ]);
  const payload = { coldStartToInteractiveMs: interactive, jsBootMs: jsBoot };
  await invokeCommand('report_metrics', { payload: JSON.stringify(payload) }).catch(() => {});
}

export function sampleProcessUptime(): Promise<number> {
  return isTauri()
    ? invokeCommand<number>('process_uptime_ms').catch(() => NaN)
    : Promise.resolve(NaN);
}
