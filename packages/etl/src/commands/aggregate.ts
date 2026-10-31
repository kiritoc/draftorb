import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveRepoRoot } from '../config/paths';
import { aggregateRoleProb } from '../aggregate';
import { parsePositionals, type Command } from './shared';

function resolveDbPath(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
}

async function runAggregate(args: string[]): Promise<void> {
  parsePositionals(args, 0, 'aggregate');
  const dbPath = resolveDbPath();

  if (!existsSync(dbPath)) {
    console.log(`no database at ${dbPath}`);
    return;
  }

  const db = new Database(dbPath);
  try {
    const rows = aggregateRoleProb(db);
    console.log(`Aggregated role probabilities: ${rows.length} row(s) written to role_prob.`);
    for (const row of rows) {
      console.log(
        `  champion ${row.championId} ${row.role}: games=${row.games} prob=${(row.prob * 100).toFixed(2)}%`,
      );
    }
  } finally {
    db.close();
  }
}

export const aggregateCommand: Command = {
  name: 'aggregate',
  usage: 'aggregate',
  description: 'Compute aggregated tables (role probabilities)',
  run: runAggregate,
};
