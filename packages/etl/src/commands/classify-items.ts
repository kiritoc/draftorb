import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { fetchLatestVersion, fetchRawItems, getPatchFromVersion } from '../ddragon';
import { buildItemClasses, generatedClassesPath, overridesClassesPath } from '../item-classes';
import { UsageError } from '../cli-args';
import { type Command, log } from './shared';

async function runClassifyItems(args: string[]): Promise<void> {
  const check = args.includes('--check');
  const versionArg = args.find((a) => !a.startsWith('--'));

  const version = versionArg ?? (await fetchLatestVersion(undefined, fetch));
  const patch = getPatchFromVersion(version);
  log.info(`Classifying items for patch ${patch} (Data Dragon ${version})...`);

  const rawItems = await fetchRawItems(version, fetch);
  const generated = buildItemClasses(rawItems);
  const outputPath = generatedClassesPath();

  if (check) {
    let existing: string;
    try {
      existing = await readFile(outputPath, 'utf8');
    } catch {
      throw new UsageError(
        `item-classes.generated.json missing at ${outputPath}; run etl classify-items`,
      );
    }
    const existingJson = JSON.parse(existing) as { items?: unknown };
    if (JSON.stringify(existingJson.items ?? {}) !== JSON.stringify(generated)) {
      throw new UsageError(
        'item-classes.generated.json is stale; run `pnpm etl classify-items` and commit the result',
      );
    }
    log.info('item-classes.generated.json is up to date.');
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ patch, version, items: generated }, null, 2)}\n`,
    'utf8',
  );
  log.info(`Wrote ${Object.keys(generated).length} item classes to ${outputPath}`);
  log.info(`Manual overrides: ${overridesClassesPath()} (create to pin classes)`);
}

export const classifyItemsCommand: Command = {
  name: 'classify-items',
  usage: 'classify-items [version] [--check]',
  description: 'Generate item-classes.generated.json from Data Dragon item taxonomy',
  run: runClassifyItems,
};
