import { parseArgs } from 'node:util';

import { discoverPlayersByTier } from '../players';
import { resolveDbPath } from '../config/paths';
import { openDb } from '../db';
import { UsageError, parseQuotaList, parseTierList } from '../cli-args';
import { log, parsePlatform, type Command } from './shared';

async function runPlayers(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        platform: { type: 'string', short: 'p' },
        tiers: { type: 'string' },
        quota: { type: 'string' },
        reset: { type: 'boolean', default: false },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `${message}\nUsage: etl players [platform] [--tiers=EMERALD,DIAMOND,...] [--quota=EMERALD:250,...]`,
    );
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) {
    throw new UsageError('Too many positional arguments.\nUsage: etl players [platform]');
  }

  const [platformArg] = positionals;
  const platformValue = typeof values.platform === 'string' ? values.platform : undefined;
  const tiersValue = typeof values.tiers === 'string' ? values.tiers : undefined;
  const quotaValue = typeof values.quota === 'string' ? values.quota : undefined;
  const resetValue = values.reset === true;
  const platform = parsePlatform(platformArg ?? platformValue);
  const tiers = typeof tiersValue === 'string' ? parseTierList(tiersValue) : undefined;
  const quotas = typeof quotaValue === 'string' ? parseQuotaList(quotaValue) : undefined;

  log.info(`Discovering players for platform "${platform}"...`);
  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  try {
    const result = await discoverPlayersByTier({
      platform,
      tiers,
      quotas,
      db,
      reset: resetValue,
    });

    log.info(`Discovered ${result.totalStored} players across ${result.tierResults.length} tiers.`);
    for (const tierResult of result.tierResults) {
      log.detail(
        `${tierResult.tier}: ${tierResult.stored} stored (${tierResult.fetched} fetched, status=${tierResult.status})`,
      );
    }
  } finally {
    db.close();
  }
}

export const playersCommand: Command = {
  name: 'players',
  usage: 'players [platform] [--tiers=EMERALD,DIAMOND,...] [--quota=EMERALD:250,...]',
  description: 'Discover players by tier and persist their rank data into SQLite',
  run: runPlayers,
};
