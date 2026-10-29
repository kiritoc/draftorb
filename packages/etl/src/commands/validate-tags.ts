import { CliError } from '../cli-args';
import { formatCoverageReport, validateChampionTagsFile } from '../tags';
import { log, parsePositionals, type Command } from './shared';

async function runValidateTags(args: string[]): Promise<void> {
  const [tagsFilePath, championsFilePath] = parsePositionals(
    args,
    2,
    'validate-tags [tags] [champs]',
  );

  log.info('Validating manual champion tags and coverage...');
  const result = await validateChampionTagsFile({ tagsFilePath, championsFilePath });

  console.log(formatCoverageReport(result.coverage));

  if (!result.isValid) {
    const details = result.errors.map((error) => `  - ${error}`).join('\n');
    throw new CliError(`Validation FAILED with ${result.errors.length} error(s):\n${details}`);
  }

  log.info('Champion tags validation PASSED.');
}

export const validateTagsCommand: Command = {
  name: 'validate-tags',
  aliases: ['tags:validate'],
  usage: 'validate-tags [tags] [champs]',
  description:
    'Validate manual champion tags and report coverage (both paths optional, module defaults apply)',
  run: runValidateTags,
};
