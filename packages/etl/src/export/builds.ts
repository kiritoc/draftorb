/**
 * @draftorb/etl — Exported build files `roles/<ROLE>/builds/<championId>.json`.
 *
 * B5: contexts are grouped by a structured key
 * `JSON.stringify([slotIdx, timeBucket, stateBucket, profileKey, laneKey])`
 * with the original values kept from the first row — no `split('|')`, so a
 * `laneKey` containing `|` (e.g. `lane:SUPPORT|ADC`) cannot corrupt the key.
 * A missing `laneKey` is `null`/absent (schema `laneKey?: string`), never the
 * `''` sentinel.
 * B4: pickShare = item.gamesW / sum(gamesW of all items in the same context),
 * rounded with round6; never a constant 0.
 * C1: items sorted by gamesW desc then itemId asc; contexts sorted by key.
 * B6: builds are grouped by (championId, myRole); written under the role's own
 * directory. myRole comes from the group key.
 */

import { championIdSchema, itemBuildExportSchema, roleSchema } from '@draftorb/shared';
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
  items: ItemBuildEntryWithKey[];
}

export interface RuneBuildFiles {
  files: Array<{ relativePath: string; content: string }>;
}

export function buildBuildFiles(
  rows: readonly ItemBuildRow[],
  roles: readonly string[],
  exportMinGames: number,
): RuneBuildFiles {
  const roleSet = new Set(roles);
  // Group by (championId, myRole) (B6).
  const byGroup = new Map<string, { myRole: string; rows: ItemBuildRow[] }>();

  for (const row of rows) {
    if (!roleSet.has(row.myRole)) continue;
    if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
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
    championIdSchema.parse(championId);
    roleSchema.parse(myRole);
    // B5: structured grouping key; original values retained from first row.
    const byContext = new Map<string, ItemBuildContextWithKey>();
    for (const row of groupRows) {
      const contextKey = JSON.stringify([
        row.slotIdx,
        row.timeBucket,
        row.stateBucket,
        row.profileKey,
        row.laneKey,
      ]);
      let ctx = byContext.get(contextKey);
      if (ctx === undefined) {
        ctx = {
          slotIdx: row.slotIdx,
          timeBucket: row.timeBucket,
          stateBucket: row.stateBucket,
          profileKey: row.profileKey,
          laneKey: row.laneKey,
          items: [],
        };
        byContext.set(contextKey, ctx);
      }
      ctx.items.push({
        itemId: row.itemId,
        winsW: round6(row.winsW),
        gamesW: round6(row.gamesW),
        gamesW2: round6(row.gamesW2),
        winrate: row.gamesW > 0 ? round6(row.winsW / row.gamesW) : 0,
        pickShare: 0, // filled below per context
      });
    }
    const contexts: ItemBuildContextWithKey[] = [];
    for (const ctx of byContext.values()) {
      // B4: pickShare = item.gamesW / sum(gamesW of all items in this context).
      const gamesWTotal = ctx.items.reduce((sum, item) => sum + item.gamesW, 0);
      for (const item of ctx.items) {
        item.pickShare = gamesWTotal > 0 ? round6(item.gamesW / gamesWTotal) : 0;
      }
      // C1: sort items by gamesW desc, then itemId asc.
      ctx.items.sort((a, b) => b.gamesW - a.gamesW || a.itemId - b.itemId);
      contexts.push(ctx);
    }
    // C1: sort contexts by slotIdx, timeBucket, stateBucket, profileKey, laneKey.
    contexts.sort((a, b) => {
      if (a.slotIdx !== b.slotIdx) return a.slotIdx - b.slotIdx;
      if (a.timeBucket !== b.timeBucket) return a.timeBucket.localeCompare(b.timeBucket);
      if (a.stateBucket !== b.stateBucket) return a.stateBucket.localeCompare(b.stateBucket);
      if (a.profileKey !== b.profileKey) return a.profileKey.localeCompare(b.profileKey);
      const ak = a.laneKey ?? '';
      const bk = b.laneKey ?? '';
      return ak.localeCompare(bk);
    });
    const exportObj = {
      championId,
      myRole,
      contexts: contexts.map(
        ({ slotIdx, timeBucket, stateBucket, profileKey, laneKey, items }) => ({
          slotIdx,
          timeBucket,
          stateBucket,
          profileKey,
          ...(laneKey === null || laneKey === '' ? {} : { laneKey }),
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
      itemBuildExportSchema.parse(exportObj);
    } catch (error) {
      throw new Error(
        `Invalid build export for roles/${myRole}/builds/${championId}.json: ${(error as Error).message}`,
      );
    }
    files.push({
      relativePath: `roles/${myRole}/builds/${championId}.json`,
      content: JSON.stringify(exportObj),
    });
  }

  return { files };
}
