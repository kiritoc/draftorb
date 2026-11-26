import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { latestSchema, manifestSchema } from '@draftorb/shared';

import { defaultPublicDataDir } from '../config/paths';
import { CliError, UsageError } from '../cli-args';
import { buildSampleReport, type SampleReportEntry } from '../export/sample-report';
import { log, parsePositionals, type Command } from './shared';

const USAGE = 'sample-report [patch]';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/**
 * Per-file sample-size report for the exported role data (BL-011): for every
 * file under `roles/<ROLE>/` it prints the row count and the min / median /
 * max `n_eff` (`games_w^2 / games_w2`). The report drives the UI role
 * enablement rule (a role is selectable only when its export passes the
 * agreed sample-size check); thresholds are set from this output and need
 * owner confirmation before becoming a gate.
 */
async function runSampleReport(args: string[]): Promise<void> {
  const [patchArg] = parsePositionals(args, 1, USAGE);
  const publicDir = process.env.DRAFTORB_PUBLIC_DIR ?? defaultPublicDataDir();

  let patch = patchArg;
  if (patch === undefined) {
    const latestPath = join(publicDir, 'latest.json');
    if (!existsSync(latestPath)) {
      throw new CliError(
        `no latest.json in ${publicDir}; pass a patch explicitly or run \`pnpm etl export\` first`,
      );
    }
    patch = latestSchema.parse(readJson(latestPath)).patch;
  }

  const patchDir = join(publicDir, patch);
  const manifestPath = join(patchDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new CliError(`no manifest at ${manifestPath}; run \`pnpm etl export\` first`);
  }
  const manifest = manifestSchema.parse(readJson(manifestPath));
  if (manifest.patch !== patch) {
    throw new UsageError(
      `manifest patch ${manifest.patch} does not match requested patch ${patch}`,
    );
  }

  const entries: SampleReportEntry[] = [];
  for (const file of manifest.files) {
    if (!file.path.startsWith('roles/')) continue;
    const fullPath = join(patchDir, file.path);
    if (!existsSync(fullPath)) {
      throw new CliError(`manifest lists ${file.path} but the file is missing`);
    }
    entries.push({ path: file.path, json: readJson(fullPath) });
  }

  const reports = buildSampleReport(entries);
  if (reports.length === 0) {
    log.info(`patch ${patch}: no roles/<ROLE>/ files in the manifest`);
    return;
  }

  log.info(`Sample-size report for patch ${patch} (n_eff = games_w^2 / games_w2):`);
  for (const report of reports) {
    log.detail(
      `${report.role}: ${report.rows} row(s) across ${report.files.length} file(s)` +
        ` — n_eff min ${formatNEff(report.nEffMin)}, median ${formatNEff(report.nEffMedian)}, max ${formatNEff(report.nEffMax)}`,
    );
    for (const file of report.files) {
      log.detail(
        `${file.path}: ${file.rows} row(s), n_eff min ${formatNEff(file.nEffMin)}, ` +
          `median ${formatNEff(file.nEffMedian)}, max ${formatNEff(file.nEffMax)}`,
      );
    }
  }
}

function formatNEff(value: number | null): string {
  // Two decimals so a near-threshold minimum (e.g. 9.97) is not shown as the
  // `exportMinGames` cutoff (10.0).
  return value === null ? 'n/a' : value.toFixed(2);
}

export const sampleReportCommand: Command = {
  name: 'sample-report',
  usage: USAGE,
  description: 'Per-file row counts and n_eff distribution for exported role data (BL-011)',
  run: runSampleReport,
};
