/**
 * @draftorb/etl — Exported build files `roles/<ROLE>/builds/<championId>.json`.
 *
 * B5: contexts are grouped by a structured key
 * `JSON.stringify([slotIdx, timeBucket, stateBucket, profileKey, laneKey])`
 * with the original values kept from the first row — no `split('|')`, so a
 * `laneKey` containing `|` (e.g. `lane:SUPPORT|ADC`) cannot corrupt the key.
 * A missing `laneKey` is `null`/absent (schema `laneKey?: string`), never the
 * `''` sentinel.
 * Pick shares use raw gamesW divided by all rows in the context before the
 * export gate, then are rounded once.
 * C1: items sorted by gamesW desc then itemId asc; contexts sorted by key.
 * B6: builds are grouped by (championId, myRole); written under the role's own
 * directory. myRole comes from the group key.
 */

import {
  championIdSchema,
  itemBuildExportSchema,
  roleSchema,
  type ChampionTagsMap,
} from '@draftorb/shared';
import { laneArchKey } from '@draftorb/engine';
import { passesGate, round6 } from './io.js';

export interface ItemBuildRow {
  championId: number;
  myRole: string;
  slotIdx: number;
  timeBucket: string;
  stateBucket: string;
  profileKey: string;
  laneKey: string | null;
  itemId: number;
  winsW: number;
  gamesW: number;
  gamesW2: number;
}

export interface BuildFilesOptions {
  /** Subdirectory under roles/<ROLE>/ (default 'builds'; 'build-paths' for path rows). */
  subdirectory?: string;
  /** Champion tags for the lane-archetype backoff field (D-086). */
  championTags?: ChampionTagsMap;
}

interface ItemBuildEntryWithKey {
  itemId: number;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  winrate: number;
  pickShare: number;
}

interface ItemBuildContextWithKey {
  slotIdx: number;
  timeBucket: string;
  stateBucket: string;
  profileKey: string;
  laneKey: string | null;
  laneArch: string | null;
  items: ItemBuildEntryWithKey[];
}

export interface RuneBuildFiles {
  files: Array<{ relativePath: string; content: string }>;
}

export function buildBuildFiles(
  rows: readonly ItemBuildRow[],
  roles: readonly string[],
  exportMinGames: number,
  options: BuildFilesOptions = {},
): RuneBuildFiles {
  const subdirectory = options.subdirectory ?? 'builds';
  const tags = options.championTags;
  const roleSet = new Set(roles);
  // Group by (championId, myRole) (B6).
  const byGroup = new Map<string, { myRole: string; rows: ItemBuildRow[] }>();

  for (const row of rows) {
    if (!roleSet.has(row.myRole)) continue;
    const groupKey = `${String(row.championId)}::${row.myRole}`;
    const existing = byGroup.get(groupKey);
    if (existing === undefined) {
      byGroup.set(groupKey, { myRole: row.myRole, rows: [row] });
    } else {
      existing.rows.push(row);
    }
  }

  const files: Array<{ relativePath: string; content: string }> = [];
  for (const { myRole, rows: groupRows } of byGroup.values()) {
    const championId = groupRows[0]?.championId;
    if (championId === undefined) continue;
    // B5: structured grouping key; original values retained from first row.
    const byContext = new Map<string, ItemBuildContextWithKey>();
    for (const row of groupRows) {
      const laneKey = row.laneKey === '' ? null : row.laneKey;
      const contextKey = JSON.stringify([
        row.slotIdx,
        row.timeBucket,
        row.stateBucket,
        row.profileKey,
        laneKey,
      ]);
      let ctx = byContext.get(contextKey);
      if (ctx === undefined) {
        const laneArch =
          laneKey !== null && laneKey !== '' && tags !== undefined
            ? laneArchKey(laneKey, tags) || null
            : null;
        ctx = {
          slotIdx: row.slotIdx,
          timeBucket: row.timeBucket,
          stateBucket: row.stateBucket,
          profileKey: row.profileKey,
          laneKey,
          laneArch,
          items: [],
        };
        byContext.set(contextKey, ctx);
      }
      ctx.items.push({
        itemId: row.itemId,
        winsW: row.winsW,
        gamesW: row.gamesW,
        gamesW2: row.gamesW2,
        winrate: row.gamesW > 0 ? row.winsW / row.gamesW : 0,
        pickShare: 0,
      });
    }
    const contexts: ItemBuildContextWithKey[] = [];
    for (const ctx of byContext.values()) {
      const gamesWTotal = ctx.items.reduce((sum, item) => sum + item.gamesW, 0);
      for (const item of ctx.items) {
        item.pickShare = gamesWTotal > 0 ? Math.min(1, item.gamesW / gamesWTotal) : 0;
      }
      ctx.items = ctx.items.filter((item) => passesGate(item.gamesW, item.gamesW2, exportMinGames));
      if (ctx.items.length === 0) continue;
      for (const item of ctx.items) {
        item.winsW = round6(item.winsW);
        item.gamesW = round6(item.gamesW);
        item.gamesW2 = round6(item.gamesW2);
        item.winrate = round6(item.winrate);
        item.pickShare = round6(item.pickShare);
      }
      // C1: sort items by gamesW desc, then itemId asc.
      ctx.items.sort((a, b) => b.gamesW - a.gamesW || a.itemId - b.itemId);
      contexts.push(ctx);
    }
    // No context survived the gate: do not emit an empty build file.
    if (contexts.length === 0) continue;
    // C1: sort contexts by slotIdx, timeBucket, stateBucket, profileKey, laneKey.
    contexts.sort((a, b) => {
      if (a.slotIdx !== b.slotIdx) return a.slotIdx - b.slotIdx;
      if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
      if (a.stateBucket !== b.stateBucket) return a.stateBucket.localeCompare(b.stateBucket);
      if (a.profileKey !== b.profileKey) return a.profileKey.localeCompare(b.profileKey);
      const ak = a.laneKey ?? '';
      const bk = b.laneKey ?? '';
      if (ak !== bk) return ak.localeCompare(bk);
      return (a.laneArch ?? '').localeCompare(b.laneArch ?? '');
    });
    const exportObj = {
      championId,
      myRole,
      contexts: contexts.map(
        ({ slotIdx, timeBucket, stateBucket, profileKey, laneKey, laneArch, items }) => ({
          slotIdx,
          timeBucket,
          stateBucket,
          profileKey,
          ...(laneKey === null || laneKey === '' ? {} : { laneKey }),
          ...(laneArch === null || laneArch === '' ? {} : { laneArch }),
          items: items.map((item) => ({
            itemId: item.itemId,
            winsW: item.winsW,
            gamesW: item.gamesW,
            gamesW2: item.gamesW2,
            winrate: item.winrate,
            pickShare: item.pickShare,
          })),
        }),
      ),
    };
    try {
      championIdSchema.parse(championId);
      roleSchema.parse(myRole);
      itemBuildExportSchema.parse(exportObj);
    } catch (error: unknown) {
      throw new Error(
        `Invalid build export for roles/${myRole}/${subdirectory}/${championId}.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    files.push({
      relativePath: `roles/${myRole}/${subdirectory}/${championId}.json`,
      content: JSON.stringify(exportObj),
    });
  }

  return { files };
}
