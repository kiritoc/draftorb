import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveRepoRoot } from '../config/paths';
import { aggregateBaseline } from '../aggregate-baseline';
import { aggregateRoleProb, PATCH_PATTERN } from '../aggregate';
import { UsageError } from '../cli-args';
import { parsePositionals, type Command } from './shared';

function resolveDbPath(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
}

async function runAggregate(args: string[]): Promise<void> {
  const [patch] = parsePositionals(args, 1, 'aggregate [patch]');
  if (patch !== undefined && !PATCH_PATTERN.test(patch)) {
    throw new UsageError(`Invalid patch "${patch}". Expected a format like "16.21".`);
  }
  const dbPath = resolveDbPath();

  if (!existsSync(dbPath)) {
    console.log(`no database at ${dbPath}`);
    return;
  }

  const db = new Database(dbPath);
  try {
    const rows = aggregateRoleProb(db, patch);
    if (rows.length === 0) {
      console.log(
        `No participants found${patch === undefined ? '' : ` for patch ${patch}`}; role_prob left unchanged.`,
      );
    } else {
      console.log(`Aggregated role probabilities: ${rows.length} row(s) written to role_prob.`);
      for (const row of rows) {
        console.log(
          `  champion ${row.championId} ${row.role}: games=${row.games} prob=${(row.prob * 100).toFixed(2)}%`,
        );
      }
    }

    const baselineRows = aggregateBaseline(db, { patch });
    if (baselineRows.length === 0) {
      console.log(
        `No contributing games${patch === undefined ? '' : ` up to patch ${patch}`}; baseline left unchanged.`,
      );
    } else {
      const champions = new Set(baselineRows.map((row) => row.championId)).size;
      console.log(
        `Aggregated baselines: ${baselineRows.length} row(s) for ${champions} champion(s) written to baseline.`,
      );
    }
  } finally {
    db.close();
  }
}

export const aggregateCommand: Command = {
  name: 'aggregate',
  usage: 'aggregate [patch]',
  description: 'Compute aggregated tables (role probabilities and rank-weighted baselines)',
  run: runAggregate,
};
