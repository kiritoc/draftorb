/**
 * @draftorb/etl — Exported starter files (BL-031a, D-086 bundle half).
 *
 * Two shapes from `starter_ctx`:
 *  - `roles/<ROLE>/starters/<championId>.json` — champion-scoped contexts
 *    (`lane:<slots>` exact lane at level 1, `champion` at level 2).
 *  - `roles/<ROLE>/starters.json` — role-scoped fallbacks: `role` (level 3,
 *    all champions of the role) and `global` (level 4, cross-role; the same
 *    rows are repeated in every role file).
 *
 * Same conventions as the rune/summoner exports: contexts keyed by
 * (rankBucket, contextKey, contextLevel); every bundle passes the
 * `exportMinGames` gate and the D-102 `minDistinctPlayers` gate; pick shares
 * use raw gamesW over all rows in the context before the export gate and are
 * rounded once; `winrate`, `pickShare` and `players` stay separate fields.
 *
 * `bundle_key` is the engine `starterBundleKey` output ("itemId:count,...");
 * malformed keys are skipped and counted.
 */

import { RANK_BUCKET_ORDER } from '@draftorb/engine';
import {
  championIdSchema,
  roleSchema,
  starterChampionExportSchema,
  starterRoleExportSchema,
  type RankBucket,
  type StarterBundleItem,
} from '@draftorb/shared';
import { passesGate, round6 } from './io.js';

export interface StarterCtxRow {
  championId: number | null;
  myRole: string | null;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  bundleKey: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  players: number;
}

interface StarterBundleWithKey {
  items: StarterBundleItem[];
  winsW: number;
  gamesW: number;
  gamesW2: number;
  winrate: number;
  pickShare: number;
  players: number;
  bundleKey: string; // internal, deterministic tie-break, stripped on output
}

interface StarterContextWithKey {
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  bundles: StarterBundleWithKey[];
}

export interface StarterBuildFiles {
  files: Array<{ relativePath: string; content: string }>;
  /** Rows dropped because bundle_key was not "itemId:count,..." pairs. */
  skippedBundles: number;
}

/** Parses "2052:1,3340:2" into sorted [{itemId,count}] or null when malformed. */
export function parseBundleKey(bundleKey: string): StarterBundleItem[] | null {
  if (bundleKey === '') return null;
  const items: StarterBundleItem[] = [];
  for (const part of bundleKey.split(',')) {
    const pair = part.split(':');
    if (pair.length !== 2) return null;
    const itemId = Number(pair[0]);
    const count = Number(pair[1]);
    if (!Number.isInteger(itemId) || itemId <= 0) return null;
    if (!Number.isInteger(count) || count <= 0) return null;
    items.push({ itemId, count });
  }
  items.sort((a, b) => a.itemId - b.itemId);
  return items;
}

interface ContextGroup {
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  rows: StarterCtxRow[];
}

function groupContexts(rows: readonly StarterCtxRow[]): Map<string, ContextGroup> {
  const byContext = new Map<string, ContextGroup>();
  for (const row of rows) {
    const contextId = JSON.stringify([row.rankBucket, row.contextKey, row.contextLevel]);
    const existing = byContext.get(contextId);
    if (existing === undefined) {
      byContext.set(contextId, {
        rankBucket: row.rankBucket,
        contextKey: row.contextKey,
        contextLevel: row.contextLevel,
        rows: [row],
      });
    } else {
      existing.rows.push(row);
    }
  }
  return byContext;
}

function sortContexts(contexts: StarterContextWithKey[]): StarterContextWithKey[] {
  contexts.sort(
    (a, b) =>
      RANK_BUCKET_ORDER.indexOf(a.rankBucket) - RANK_BUCKET_ORDER.indexOf(b.rankBucket) ||
      a.contextLevel - b.contextLevel ||
      a.contextKey.localeCompare(b.contextKey),
  );
  return contexts;
}

function toContextEntries(
  byContext: Map<string, ContextGroup>,
  exportMinGames: number,
  minDistinctPlayers: number,
  skipped: { count: number },
): StarterContextWithKey[] {
  const contexts: StarterContextWithKey[] = [];
  for (const { rankBucket, contextKey, contextLevel, rows: ctxRows } of byContext.values()) {
    const bundles: StarterBundleWithKey[] = [];
    const gamesWTotal = ctxRows.reduce((sum, row) => sum + row.gamesW, 0);
    for (const row of ctxRows) {
      if (row.players < minDistinctPlayers) continue;
      if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
      const items = parseBundleKey(row.bundleKey);
      if (items === null) {
        skipped.count += 1;
        continue;
      }
      bundles.push({
        items,
        winsW: round6(row.winsW),
        gamesW: round6(row.gamesW),
        gamesW2: round6(row.gamesW2),
        winrate: row.gamesW > 0 ? round6(row.winsW / row.gamesW) : 0,
        pickShare: gamesWTotal > 0 ? round6(Math.min(1, row.gamesW / gamesWTotal)) : 0,
        players: row.players,
        bundleKey: row.bundleKey,
      });
    }
    if (bundles.length === 0) continue;
    bundles.sort((a, b) => b.gamesW - a.gamesW || a.bundleKey.localeCompare(b.bundleKey));
    contexts.push({ rankBucket, contextKey, contextLevel, bundles });
  }
  return sortContexts(contexts);
}

function stripBundleKeys(contexts: StarterContextWithKey[]) {
  return contexts.map(({ rankBucket, contextKey, contextLevel, bundles }) => ({
    rankBucket,
    contextKey,
    contextLevel,
    bundles: bundles.map(({ bundleKey: _bk, ...rest }) => rest),
  }));
}

export function buildStarterFiles(
  rows: readonly StarterCtxRow[],
  roles: readonly string[],
  exportMinGames: number,
  minDistinctPlayers = 1,
): StarterBuildFiles {
  const roleSet = new Set(roles);
  const skipped = { count: 0 };
  const files: Array<{ relativePath: string; content: string }> = [];

  // --- Champion-scoped files: rows with a champion_id ---
  const byGroup = new Map<string, { myRole: string; rows: StarterCtxRow[] }>();
  for (const row of rows) {
    if (row.championId === null || row.myRole === null) continue;
    if (!roleSet.has(row.myRole)) continue;
    const groupKey = `${String(row.championId)}::${row.myRole}`;
    const existing = byGroup.get(groupKey);
    if (existing === undefined) {
      byGroup.set(groupKey, { myRole: row.myRole, rows: [row] });
    } else {
      existing.rows.push(row);
    }
  }
  for (const { myRole, rows: groupRows } of byGroup.values()) {
    const championId = groupRows[0]?.championId;
    if (championId === undefined || championId === null) continue;
    const contexts = toContextEntries(
      groupContexts(groupRows),
      exportMinGames,
      minDistinctPlayers,
      skipped,
    );
    if (contexts.length === 0) continue;
    const exportObj = {
      championId,
      myRole,
      contexts: stripBundleKeys(contexts),
    };
    try {
      championIdSchema.parse(championId);
      roleSchema.parse(myRole);
      starterChampionExportSchema.parse(exportObj);
    } catch (error: unknown) {
      throw new Error(
        `Invalid starter export for roles/${myRole}/starters/${championId}.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    files.push({
      relativePath: `roles/${myRole}/starters/${championId}.json`,
      content: JSON.stringify(exportObj),
    });
  }

  // --- Role files: 'role' rows of the role + the shared 'global' rows ---
  for (const role of roles) {
    const roleRows = rows.filter(
      (row) =>
        row.championId === null &&
        ((row.myRole === role && row.contextLevel < 4) || row.myRole === null),
    );
    if (roleRows.length === 0) continue;
    const contexts = toContextEntries(
      groupContexts(roleRows),
      exportMinGames,
      minDistinctPlayers,
      skipped,
    );
    if (contexts.length === 0) continue;
    const exportObj = { myRole: role, contexts: stripBundleKeys(contexts) };
    try {
      roleSchema.parse(role);
      starterRoleExportSchema.parse(exportObj);
    } catch (error: unknown) {
      throw new Error(
        `Invalid starter export for roles/${role}/starters.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    files.push({
      relativePath: `roles/${role}/starters.json`,
      content: JSON.stringify(exportObj),
    });
  }

  return { files, skippedBundles: skipped.count };
}
