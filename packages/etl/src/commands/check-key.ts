import { RiotClient } from '../riot';
import { log, parsePlatform, parsePositionals, type Command, DEFAULT_PLATFORM } from './shared';

async function runCheckKey(args: string[]): Promise<void> {
  const [platformArg] = parsePositionals(args, 1, 'check-key [platform]');
  const platform = parsePlatform(platformArg);

  log.info(`Checking Riot API key against platform "${platform}"...`);
  const client = new RiotClient();
  const challenger = await client.getChallengerLeague(platform);

  log.info(
    `Riot API key is valid! Successfully reached ${platform} Challenger league ("${challenger.name}").`,
  );
  log.detail(`Entries: ${challenger.entries.length} players found`);
  log.detail('Active App Limits:', client.getRateLimiter().getAppLimits());
}

export const checkKeyCommand: Command = {
  name: 'check-key',
  aliases: ['riot:check'],
  usage: 'check-key [platform]',
  description: `Test Riot API key connectivity (default platform: ${DEFAULT_PLATFORM})`,
  run: runCheckKey,
};
