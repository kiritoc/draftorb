import { performance } from 'node:perf_hooks';

import { importStaticData } from '../ddragon';
import { log, parsePositionals, parseVersion, type Command } from './shared';

async function runStatic(args: string[]): Promise<void> {
  const [versionArg] = parsePositionals(args, 1, 'static [version]');
  const version = parseVersion(versionArg);

  log.info(`Starting Data Dragon static import${version ? ` (version: ${version})` : ''}...`);
  const startTime = performance.now();
  const result = await importStaticData({ version });
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

  log.info(
    `Imported patch ${result.patch} (Data Dragon version ${result.version}) in ${elapsed}s:`,
  );
  log.detail(`Champions: ${result.championsCount} validated -> ${result.outputPaths.champions}`);
  log.detail(`Items: ${result.itemsCount} validated -> ${result.outputPaths.items}`);
  log.detail(`Rune trees: ${result.runeTreesCount} validated -> ${result.outputPaths.runes}`);
  log.info('Static data import complete.');
}

export const staticCommand: Command = {
  name: 'static',
  usage: 'static [version]',
  description: 'Download latest (or specified) champions, items, runes from Data Dragon',
  run: runStatic,
};
