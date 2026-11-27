import { existsSync } from 'node:fs';

import { dbPathFromEnv } from '../config/paths';
import { getMigrationStatus, openDb } from '../db';
import { aggregateBaseline } from '../aggregate-baseline';
import { aggregatePairTables } from '../aggregate-pairs';
import { aggregateRunesByContext } from '../aggregate-runes';
import { aggregateSummonersByContext } from '../aggregate-summoners';
import { aggregateStarterBundles } from '../aggregate-starters';
import { aggregateItemBuilds } from '../aggregate-items';
import { aggregateRoleProb, latestPatch, PATCH_PATTERN } from '../aggregate';
import { loadPatchWindow } from '../aggregate-shared';
import { recordAggregateSnapshot } from '../aggregate-meta';
import { ensurePatchCoverage, latestPatchIndex, lookupPatchIndex } from '../patches';
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
    // (D-043/D-055): `versions.json` is fetched at most once and only when the
    // explicit snapshot or a stored label is missing. Stored labels still
    // unresolved afterwards are orphans: excluded from the aggregates and
    // reported, never dropped silently.
    const coverage = await ensurePatchCoverage(db, {
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
    if (coverage.orphanMatches > 0) {
      console.log(
        `[ETL] Warning: excluded ${coverage.orphanMatches} match(es) whose patch label(s) ` +
          `are absent from the patches table: ${coverage.orphanLabels.join(', ')}`,
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

    let runeCtxWritten = false;
    const runeRows = aggregateRunesByContext(db, {
      patch,
      onWrite: () => {
        runeCtxWritten = true;
      },
    });
    if (runeRows.length === 0) {
      console.log(
        runeCtxWritten
          ? `All contributing rune contexts were suppressed by the evidence rule${patch === undefined ? '' : ` up to patch ${patch}`}; rune_ctx cleared.`
          : `No contributing games${patch === undefined ? '' : ` up to patch ${patch}`}; rune_ctx left unchanged.`,
      );
    } else {
      const champions = new Set(runeRows.map((row) => row.championId)).size;
      console.log(
        `Aggregated rune contexts: ${runeRows.length} row(s) for ${champions} champion(s) written to rune_ctx.`,
      );
    }

    let itemBuildWritten = false;
    const itemRows = await aggregateItemBuilds(db, {
      patch,
      onWarn: (message) => console.log(`[ETL] Warning: ${message}`),
      onWrite: () => {
        itemBuildWritten = true;
      },
    });
    if (itemRows.length === 0) {
      console.log(
        itemBuildWritten
          ? `All contributing item builds were suppressed by the evidence rule${patch === undefined ? '' : ` up to patch ${patch}`}; item_build cleared.`
          : `No item purchases${patch === undefined ? '' : ` up to patch ${patch}`}; item_build left unchanged.`,
      );
    } else {
      const champions = new Set(itemRows.map((row) => row.championId)).size;
      console.log(
        `Aggregated item builds: ${itemRows.length} row(s) for ${champions} champion(s) written to item_build.`,
      );
    }

    // Summoner pairs and starter bundles run after item builds: starter_ctx
    // reads participant_starters, which aggregateItemBuilds rewrites.
    let summonerCtxWritten = false;
    const summonerRows = aggregateSummonersByContext(db, {
      patch,
      onWrite: () => {
        summonerCtxWritten = true;
      },
    });
    if (summonerRows.length === 0) {
      console.log(
        summonerCtxWritten
          ? `All contributing summoner contexts were suppressed by the evidence rule${patch === undefined ? '' : ` up to patch ${patch}`}; summoner_ctx cleared.`
          : `No contributing games${patch === undefined ? '' : ` up to patch ${patch}`}; summoner_ctx left unchanged.`,
      );
    } else {
      const champions = new Set(summonerRows.map((row) => row.championId)).size;
      console.log(
        `Aggregated summoner contexts: ${summonerRows.length} row(s) for ${champions} champion(s) written to summoner_ctx.`,
      );
    }

    let starterCtxWritten = false;
    const starterRows = aggregateStarterBundles(db, {
      patch,
      onWrite: () => {
        starterCtxWritten = true;
      },
    });
    if (starterRows.length === 0) {
      console.log(
        starterCtxWritten
          ? `All contributing starter bundles were suppressed by the evidence rule${patch === undefined ? '' : ` up to patch ${patch}`}; starter_ctx cleared.`
          : `No starter bundles${patch === undefined ? '' : ` up to patch ${patch}`}; starter_ctx left unchanged.`,
      );
    } else {
      console.log(
        `Aggregated starter bundles: ${starterRows.length} row(s) written to starter_ctx.`,
      );
    }

    // Record which patch-catalog state the aggregates were computed against
    // (D-055): exported as patch-meta.json so results stay explainable when
    // the catalog later grows. Only when at least one table was rewritten —
    // an all-empty run leaves the previous aggregates (and their meta) intact.
    const wroteRows =
      rows.length +
        baselineRows.length +
        pairTables.pairAlly.length +
        pairTables.pairEnemy.length +
        pairTables.laneVs.length +
        pairTables.laneFull.length +
        runeRows.length +
        itemRows.length +
        summonerRows.length +
        starterRows.length >
      0;
    if (wroteRows) {
      const snapshotLabel = patch ?? latestPatch(db) ?? null;
      const window = loadPatchWindow(db, patch);
      recordAggregateSnapshot(db, {
        patch: snapshotLabel,
        patchIndex: snapshotLabel === null ? null : (lookupPatchIndex(db, snapshotLabel) ?? null),
        currentPatchIndex: window.currentPatchIndex,
        patchesMaxIndex: latestPatchIndex(db),
        aggregatedAt: new Date().toISOString(),
      });
    }
  } finally {
    db.close();
  }
}

export const aggregateCommand: Command = {
  name: 'aggregate',
  usage: 'aggregate [patch]',
  description:
    'Compute aggregated tables (role probabilities, rank-weighted baselines, pair tables, rune/summoner contexts, item builds and starter bundles)',
  run: runAggregate,
};
