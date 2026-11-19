import { RiotClient } from '../riot';
import type { RiotLeagueList } from '../riot/schemas';
import { log, parsePlatform, parsePositionals, type Command, DEFAULT_PLATFORM } from './shared';

/** Success line for `check-key`; Riot no longer always returns the league `name` (B-067). */
export function formatKeyCheckSuccess(
  platform: string,
  league: Pick<RiotLeagueList, 'name'>,
): string {
  const name = league.name ? ` ("${league.name}")` : '';
  return `Riot API key is valid! Successfully reached ${platform} Challenger league${name}.`;
}

async function runCheckKey(args: string[]): Promise<void> {
  const [platformArg] = parsePositionals(args, 1, 'check-key [platform]');
  const platform = parsePlatform(platformArg);

  log.info(`Checking Riot API key against platform "${platform}"...`);
  const client = new RiotClient();
  const challenger = await client.getChallengerLeague(platform);

  log.info(formatKeyCheckSuccess(platform, challenger));
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
