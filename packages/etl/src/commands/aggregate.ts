import { existsSync } from 'node:fs';

import { dbPathFromEnv } from '../config/paths';
import { getMigrationStatus, openDb } from '../db';
import { aggregateBaseline } from '../aggregate-baseline';
import { aggregatePairTables } from '../aggregate-pairs';
import { aggregateRunesByContext } from '../aggregate-runes';
import { aggregateRoleProb, PATCH_PATTERN } from '../aggregate';
import { ensurePatchesFresh, lookupPatchIndex } from '../patches';
import { CliError, UsageError } from '../cli-args';
import { parsePositionals, type Command } from './shared';

async function runAggregate(args: string[]): Promise<void> {
  const [patch] = parsePositionals(args, 1, 'aggregate [patch]');
  if (patch !== undefined && !PATCH_PATTERN.test(patch)) {
    throw new UsageError(`Invalid patch "${patch}". Expected a format like "16.21".`);
  }
  const dbPath = dbPathFromEnv();

  if (!existsSync(dbPath)) {
    console.log(`no database at ${dbPath}`);
    return;
  }

  const db = openDb(dbPath);
  try {
    const { pending } = getMigrationStatus(db);
    if (pending > 0) {
      throw new CliError(
        `Database schema is out of date (${pending} pending migration(s)); run \`pnpm etl migrate\` first.`,
      );
    }

    // Aggregation resolves every stored match label through `patches`
    // (D-043): refresh the catalog once when a label is missing, and reject an
    // explicit snapshot that Data Dragon does not know.
    const coverage = await ensurePatchesFresh(db, {
      extraLabels: patch === undefined ? [] : [patch],
      onWarn: (message) => console.log(`[ETL] Warning: ${message}`),
    });
    if (patch !== undefined && lookupPatchIndex(db, patch) === undefined) {
      throw new UsageError(
        coverage.status === 'failed'
          ? `Could not refresh patches from Data Dragon; unknown patch "${patch}".`
          : `Unknown patch "${patch}": not present in Data Dragon versions.`,
      );
    }

    const rows = aggregateRoleProb(db, { patch });
    if (rows.length === 0) {
      console.log(
        `No participants found${patch === undefined ? '' : ` for patch ${patch}`}; role_prob left unchanged.`,
      );
    } else {
      const champions = new Set(rows.map((row) => row.championId)).size;
      console.log(
        `Aggregated role probabilities: ${rows.length} row(s) for ${champions} champion(s) written to role_prob.`,
      );
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

    const pairTables = aggregatePairTables(db, { patch });
    const pairCount =
      pairTables.pairAlly.length +
      pairTables.pairEnemy.length +
      pairTables.laneVs.length +
      pairTables.laneFull.length;
    if (pairCount === 0) {
      console.log(
        `No contributing games${patch === undefined ? '' : ` up to patch ${patch}`}; pair tables left unchanged.`,
      );
    } else {
      console.log(
        `Aggregated pair tables: ${pairTables.pairAlly.length} ally, ${pairTables.pairEnemy.length} enemy, ${pairTables.laneVs.length} lane_vs, ${pairTables.laneFull.length} lane_full row(s) written.`,
      );
    }

    const runeRows = aggregateRunesByContext(db, { patch });
    if (runeRows.length === 0) {
      console.log(
        `No contributing games${patch === undefined ? '' : ` up to patch ${patch}`}; rune_ctx left unchanged.`,
      );
    } else {
      const champions = new Set(runeRows.map((row) => row.championId)).size;
      console.log(
        `Aggregated rune contexts: ${runeRows.length} row(s) for ${champions} champion(s) written to rune_ctx.`,
      );
    }
  } finally {
    db.close();
  }
}

export const aggregateCommand: Command = {
  name: 'aggregate',
  usage: 'aggregate [patch]',
  description:
    'Compute aggregated tables (role probabilities, rank-weighted baselines, pair tables and rune contexts)',
  run: runAggregate,
};
