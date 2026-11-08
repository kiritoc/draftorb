import { CliError } from '../cli-args';
import { defaultManualDataDir, defaultPublicDataDir } from '../config/paths';
import { checkPublishedExport } from '../export/sample-check';
import { join } from 'node:path';
import { log, parsePositionals, type Command } from './shared';

const USAGE = 'validate-export [public-dir] [tags-file]';

/**
 * Sanity check for the published export (B-052): runs `recommend` for every
 * exported role and fails when a role yields no "Best overall" pick. Runs in
 * the scheduled ETL workflow right after `export`, before the exports asset
 * is uploaded — a failure keeps the previous exports release.
 */
async function runValidateExport(args: string[]): Promise<void> {
  const [publicDirArg, tagsFileArg] = parsePositionals(args, 2, USAGE);
  const publicDir = publicDirArg ?? process.env.DRAFTORB_PUBLIC_DIR ?? defaultPublicDataDir();
  const tagsFilePath = tagsFileArg ?? join(defaultManualDataDir(), 'champion-tags.json');

  log.info(`Validating published export in ${publicDir}...`);
  const result = checkPublishedExport({ publicDir, tagsFilePath });

  for (const role of result.roles) {
    log.detail(`${role}: ${result.recommendationCounts[role] ?? 0} recommendation(s)`);
  }

  if (result.errors.length > 0) {
    const details = result.errors.map((error) => `  - ${error}`).join('\n');
    throw new CliError(`Export validation FAILED for patch ${result.patch}:\n${details}`);
  }

  log.info(`Export validation PASSED for patch ${result.patch}.`);
}

export const validateExportCommand: Command = {
  name: 'validate-export',
  usage: USAGE,
  description:
    'Check the published export yields recommendations for every role (run after export; B-052)',
  run: runValidateExport,
};
