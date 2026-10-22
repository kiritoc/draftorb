#!/usr/bin/env node
/**
 * CLI entrypoint for DraftOrb ETL operations.
 *
 * Usage:
 *   pnpm etl static [version]
 */

import { importStaticData } from './ddragon';
import { formatCoverageReport, validateChampionTagsFile } from './tags';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'static': {
      const versionArg = args[1];
      console.log(
        `[ETL] Starting Data Dragon static import${versionArg ? ` (version: ${versionArg})` : ''}...`,
      );
      const startTime = Date.now();
      const result = await importStaticData({ version: versionArg });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(
        `[ETL] Imported patch ${result.patch} (Data Dragon version ${result.version}) in ${elapsed}s:`,
      );
      console.log(
        `  - Champions: ${result.championsCount} validated -> ${result.outputPaths.champions}`,
      );
      console.log(`  - Items: ${result.itemsCount} validated -> ${result.outputPaths.items}`);
      console.log(
        `  - Rune trees: ${result.runeTreesCount} validated -> ${result.outputPaths.runes}`,
      );
      console.log('[ETL] Static data import complete.');
      break;
    }

    case 'validate-tags':
    case 'tags:validate': {
      console.log('[ETL] Validating manual champion tags and coverage...');
      const tagsFilePath = args[1];
      const championsFilePath = args[2];

      const result = await validateChampionTagsFile({
        tagsFilePath,
        championsFilePath,
      });

      console.log(formatCoverageReport(result.coverage));

      if (!result.isValid) {
        console.error('[ETL] Validation FAILED with errors:');
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
        process.exit(1);
      }

      console.log('[ETL] Champion tags validation PASSED.');
      break;
    }

    default: {
      console.error(`[ETL] Unknown command: "${command}"`);
      printHelp();
      process.exit(1);
    }
  }
}

function printHelp(): void {
  console.log(`
DraftOrb ETL CLI

Commands:
  static [version]              Download latest (or specified) champions, items, runes from Data Dragon
  validate-tags [tags] [champs] Validate manual champion tags and report coverage
  help                          Show this help message

Target state commands (in development):
  migrate            Create or upgrade SQLite database
  players            Discover players by tier
  matches            Ingest matches
  aggregate          Compute aggregated tables
  export             Write versioned JSON and manifest
  status             Show counts and progress
`);
}

main().catch((err: unknown) => {
  console.error('[ETL] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
