/**
 * @draftorb/etl — Exported summoner files `roles/<ROLE>/summoners/<championId>.json`.
 *
 * Mirrors the rune export conventions (BL-030/BL-031a): contexts keyed by
 * (rankBucket, contextKey, contextLevel); every pair passes the same
 * `exportMinGames` gate and the D-102 `minDistinctPlayers` gate. Pick shares
 * use raw gamesW divided by all rows in the context before the export gate,
 * then are rounded once. Win rate and pick share stay separate fields next
 * to `players` (distinct expert players).
 *
 * The spell pair is stored normalized `"minId:maxId"` and exported as
 * `summoner1Id`/`summoner2Id` in that order (SPECS §18.5).
 */

import { RANK_BUCKET_ORDER } from '@draftorb/engine';
import {
  championIdSchema,
  roleSchema,
  summonerExportSchema,
  type RankBucket,
} from '@draftorb/shared';
import { passesGate, round6 } from './io.js';

export interface SummonerCtxRow {
  championId: number;
  myRole: string;
  rankBucket: RankBucket;
  contextKey: string;
  contextLevel: number;
  /** Normalized unordered "minId:maxId". */
  spellPair: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  players: number;
}

interface SummonerPairWithKey {
  summoner1Id: number;
  summoner2Id: number;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  winrate: number;
  pickShare: number;
  players: number;
  spellPair: string; // internal, deterministic tie-break, stripped on output
}

export interface SummonerBuildFiles {
  files: Array<{ relativePath: string; content: string }>;
  /** Rows dropped because spell_pair was not "minId:maxId" integers. */
  skippedSpellPairs: number;
}

function parseSpellPair(spellPair: string): { min: number; max: number } | null {
  const parts = spellPair.split(':');
  if (parts.length !== 2) return null;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0 || b <= 0 || a >= b) {
    return null;
  }
  return { min: a, max: b };
}

export function buildSummonerFiles(
  rows: readonly SummonerCtxRow[],
  roles: readonly string[],
  exportMinGames: number,
  minDistinctPlayers = 1,
): SummonerBuildFiles {
  const roleSet = new Set(roles);
  let skipped = 0;
  // Group by (championId, myRole) so a champion with rows in two exported
  // roles gets a file under each role's directory (same as runes, B6).
  const byGroup = new Map<string, { myRole: string; rows: SummonerCtxRow[] }>();

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
    const byContext = new Map<
      string,
      { rankBucket: RankBucket; contextKey: string; contextLevel: number; rows: SummonerCtxRow[] }
    >();
    for (const row of groupRows) {
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
    const contexts: Array<{
      rankBucket: RankBucket;
      contextKey: string;
      contextLevel: number;
      pairs: SummonerPairWithKey[];
    }> = [];
    for (const { rankBucket, contextKey, contextLevel, rows: ctxRows } of byContext.values()) {
      const pairs: SummonerPairWithKey[] = [];
      const gamesWTotal = ctxRows.reduce((sum, row) => sum + row.gamesW, 0);
      for (const row of ctxRows) {
        if (row.players < minDistinctPlayers) continue;
        if (!passesGate(row.gamesW, row.gamesW2, exportMinGames)) continue;
        const pair = parseSpellPair(row.spellPair);
        if (pair === null) {
          skipped += 1;
          continue;
        }
        pairs.push({
          summoner1Id: pair.min,
          summoner2Id: pair.max,
          winsW: round6(row.winsW),
          gamesW: round6(row.gamesW),
          gamesW2: round6(row.gamesW2),
          winrate: row.gamesW > 0 ? round6(row.winsW / row.gamesW) : 0,
          pickShare: gamesWTotal > 0 ? round6(Math.min(1, row.gamesW / gamesWTotal)) : 0,
          players: row.players,
          spellPair: row.spellPair,
        });
      }
      if (pairs.length === 0) continue;
      // Same ordering rule as rune pages: gamesW desc, then stable key asc.
      pairs.sort((a, b) => b.gamesW - a.gamesW || a.spellPair.localeCompare(b.spellPair));
      contexts.push({ rankBucket, contextKey, contextLevel, pairs });
    }
    if (contexts.length === 0) continue;
    contexts.sort(
      (a, b) =>
        RANK_BUCKET_ORDER.indexOf(a.rankBucket) - RANK_BUCKET_ORDER.indexOf(b.rankBucket) ||
        a.contextLevel - b.contextLevel ||
        a.contextKey.localeCompare(b.contextKey),
    );
    const exportObj = {
      championId,
      myRole,
      contexts: contexts.map(({ rankBucket, contextKey, contextLevel, pairs }) => ({
        rankBucket,
        contextKey,
        contextLevel,
        pairs: pairs.map(({ spellPair: _sp, ...rest }) => rest),
      })),
    };
    try {
      championIdSchema.parse(championId);
      roleSchema.parse(myRole);
      summonerExportSchema.parse(exportObj);
    } catch (error: unknown) {
      throw new Error(
        `Invalid summoner export for roles/${myRole}/summoners/${championId}.json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    files.push({
      relativePath: `roles/${myRole}/summoners/${championId}.json`,
      content: JSON.stringify(exportObj),
    });
  }

  return { files, skippedSpellPairs: skipped };
}
