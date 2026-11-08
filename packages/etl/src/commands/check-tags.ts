import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { championTagsMapSchema, championsMapSchema, type ChampionTagsMap } from '@draftorb/shared';

import { defaultManualDataDir, resolveRepoRoot } from '../config/paths';
import { championTagDrift, findLatestChampionsPath } from '../tags';
import { log, parsePositionals, type Command } from './shared';

const USAGE = 'check-tags [tags-file]';

/**
 * Drift check between `data/manual/champion-tags.json` and the freshest
 * exported champion catalog (the one `pnpm etl static` just fetched). Runs in
 * the scheduled ETL workflow after the static import; it only warns — it
 * never fails, so it cannot block the database upload (D-079).
 */
async function runCheckTags(args: string[]): Promise<void> {
  const [tagsFileArg] = parsePositionals(args, 1, USAGE);
  const tagsFilePath = tagsFileArg ?? join(defaultManualDataDir(), 'champion-tags.json');

  try {
    const rawTags: unknown = JSON.parse(readFileSync(tagsFilePath, 'utf8'));
    const tags: ChampionTagsMap = championTagsMapSchema.parse(rawTags);

    const championsPath = await findLatestChampionsPath(resolveRepoRoot());
    const champions = championsMapSchema.parse(
      JSON.parse(readFileSync(championsPath, 'utf8')) as unknown,
    );

    const drift = championTagDrift(tags, champions);
    if (drift.missingSupports.length === 0 && drift.unknownTagIds.length === 0) {
      log.info(`Champion tags are in sync with ${championsPath}.`);
      return;
    }

    const missing = drift.missingSupports.map((c) => `${c.name} (id ${c.id})`).join(', ');
    const unknown = drift.unknownTagIds.join(', ');
    console.log(
      `::warning::champion-tags.json drift vs ${championsPath}: ` +
        `${drift.missingSupports.length} support champion(s) missing tags` +
        `${missing ? ` [${missing}]` : ''}; ` +
        `${drift.unknownTagIds.length} unknown tag id(s)` +
        `${unknown ? ` [${unknown}]` : ''}`,
    );
    if (drift.missingSupports.length > 0) {
      log.info(`Missing support tags: ${missing}`);
    }
    if (drift.unknownTagIds.length > 0) {
      log.info(`Unknown tag champion ids: ${unknown}`);
    }
    log.info('Run `pnpm validate:tags` for the full coverage report.');
  } catch (err) {
    // Never fail the pipeline: a drift-check problem is a warning, not a blocker.
    console.log(
      `::warning::champion-tags drift check could not run: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const checkTagsCommand: Command = {
  name: 'check-tags',
  usage: USAGE,
  description:
    'Warn when champion-tags.json drifts from the freshest exported champion list (never fails)',
  run: runCheckTags,
};
