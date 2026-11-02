/**
 * @draftorb/etl — Exported rune files `roles/<ROLE>/runes/<championId>.json`.
 *
 * D3: the most-general back-off level (`context_level === 5`, "global") is
 * exempted from the `exportMinGames` gate so a champion always keeps a fallback
 * context (T-018 acceptance: every context level present for back-off).
 * C2: contexts are keyed by (contextKey, contextLevel); a contextKey appearing
 * with differing levels is treated as separate contexts.
 * B4: pickShare = page.gamesW / sum(gamesW of all pages in the same context),
 * rounded with round6; never a constant 0.
 * C3: unparseable or invalid rune rows (parseRunePage returns null, including
 * primaryStyleId <= 0) are counted and reported via skippedRunePages.
 * B6: runes are grouped by (championId, myRole); each group is written under
 * its own `roles/<myRole>/` directory. myRole comes from the group key, never
 * from rows[0].
 */

import { championIdSchema, roleSchema, runeExportSchema } from '@draftorb/shared';
import { passesGate, round6 } from './io.js';

export interface RuneCtxRow {
  championId: number;
  myRole: string;
  rankBucket: string;
  contextKey: string;
  contextLevel: number;
  perksHash: string;
  perksJson: string;
  winsW: number;
  gamesW: number;
  gamesW2: number;
  players: number;
}

// Most-general back-off level (global). Exempt from the exportMinGames gate so
// every champion retains a fallback context (D3).
const GLOBAL_CONTEXT_LEVEL = 5;

function parseRunePage(perksJson: string): {
  primaryStyleId: number;
  subStyleId: number;
  keystoneId: number;
  selectedPerkIds: number[];
  statShardIds: number[];
} | null {
  let perks: unknown;
  try {
    perks = JSON.parse(perksJson);
  } catch {
    return null;
  }
  const obj = perks as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return null;
  const styles = (obj as { styles?: unknown }).styles;
  if (!Array.isArray(styles) || styles.length < 2) return null;
  const primary = styles[0] as { style?: unknown; selections?: unknown };
  const secondary = styles[1] as { style?: unknown; selections?: unknown };
  const primaryStyleId = typeof primary?.style === 'number' ? primary.style : 0;
  const subStyleId = typeof secondary?.style === 'number' ? secondary.style : 0;
  const primarySelections = Array.isArray(primary?.selections)
    ? (primary.selections as Array<{ perk?: unknown }>)
    : [];
  const keystoneId = typeof primarySelections[0]?.perk === 'number' ? primarySelections[0].perk : 0;
  const selectedPerkIds: number[] = [];
  for (const style of [primary, secondary]) {
    for (const sel of (style?.selections ?? []) as Array<{ perk?: unknown }>) {
      if (typeof sel.perk === 'number') selectedPerkIds.push(sel.perk);
    }
  }
  const statPerks = obj.statPerks as
    { offense?: unknown; defense?: unknown; flex?: unknown } | undefined;
  const statShardIds: number[] = [];
  if (typeof statPerks?.offense === 'number') statShardIds.push(statPerks.offense);
  if (typeof statPerks?.defense === 'number') statShardIds.push(statPerks.defense);
  if (typeof statPerks?.flex === 'number') statShardIds.push(statPerks.flex);
  if (primaryStyleId <= 0 || subStyleId <= 0 || keystoneId <= 0) return null;
  return {
    primaryStyleId,
    subStyleId,
    keystoneId,
    selectedPerkIds,
    statShardIds,
  };
}

interface RunePageWithHash {
  primaryStyleId: number;
  subStyleId: number;
  keystoneId: number;
  selectedPerkIds: number[];
  statShardIds: number[];
  winsW: number;
  gamesW: number;
  gamesW2: number;
  winrate: number;
  pickShare: number;
  players: number;
  perksHash: string; // internal, used for deterministic tie-break, stripped on output
}

export interface RuneBuildFiles {
  files: Array<{ relativePath: string; content: string }>;
  skippedRunePages: number;
}

export function buildRuneFiles(
  rows: readonly RuneCtxRow[],
  roles: readonly string[],
  exportMinGames: number,
): RuneBuildFiles {
  const roleSet = new Set(roles);
  let skipped = 0;
  // Group by (championId, myRole) so a champion with rows in two exported roles
  // gets a file under each role's directory (B6).
  const byGroup = new Map<string, { myRole: string; rows: RuneCtxRow[] }>();

  for (const row of rows) {
    if (!roleSet.has(row.myRole)) continue;
    if (
      row.contextLevel !== GLOBAL_CONTEXT_LEVEL &&
      !passesGate(row.gamesW, row.gamesW2, exportMinGames)
    )
      continue;
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
    // C2: key contexts by (contextKey, contextLevel).
    const byContext = new Map<string, RuneCtxRow[]>();
    for (const row of groupRows) {
      const contextKeyFull = `${row.contextKey}::${row.contextLevel}`;
      const existing = byContext.get(contextKeyFull);
      if (existing === undefined) {
        byContext.set(contextKeyFull, [row]);
      } else {
        existing.push(row);
      }
    }
    const contexts: Array<{ contextKey: string; contextLevel: number; pages: RunePageWithHash[] }> =
      [];
    for (const [contextKeyFull, ctxRows] of byContext) {
      const pages: RunePageWithHash[] = [];
      for (const row of ctxRows) {
        const page = parseRunePage(row.perksJson);
        if (page === null) {
          skipped += 1;
          continue;
        }
        pages.push({
          ...page,
          winsW: round6(row.winsW),
          gamesW: round6(row.gamesW),
          gamesW2: round6(row.gamesW2),
          winrate: row.gamesW > 0 ? round6(row.winsW / row.gamesW) : 0,
          pickShare: 0, // filled below per context
          players: row.players,
          perksHash: row.perksHash,
        });
      }
      if (pages.length === 0) continue;
      // B4: pickShare = page.gamesW / sum(gamesW of all pages in this context).
      const gamesWTotal = pages.reduce((sum, p) => sum + p.gamesW, 0);
      for (const p of pages) {
        p.pickShare = gamesWTotal > 0 ? round6(p.gamesW / gamesWTotal) : 0;
      }
      // C1: sort pages by gamesW desc, then perksHash asc.
      pages.sort((a, b) => b.gamesW - a.gamesW || a.perksHash.localeCompare(b.perksHash));
      const [contextKey = '', contextLevelStr = '0'] = contextKeyFull.split('::');
      const contextLevel = Number(contextLevelStr);
      contexts.push({
        contextKey,
        contextLevel,
        pages,
      });
    }
    if (contexts.length === 0) continue;
    // C1: sort contexts by level asc, then key asc.
    contexts.sort(
      (a, b) => a.contextLevel - b.contextLevel || a.contextKey.localeCompare(b.contextKey),
    );
    const exportObj = {
      championId,
      myRole,
      contexts: contexts.map(({ contextKey, contextLevel, pages }) => ({
        contextKey,
        contextLevel,
        pages: pages.map(({ perksHash: _ph, ...rest }) => rest),
      })),
    };
    try {
      runeExportSchema.parse(exportObj);
    } catch (error) {
      throw new Error(
        `Invalid rune export for roles/${myRole}/runes/${championId}.json: ${(error as Error).message}`,
      );
    }
    files.push({
      relativePath: `roles/${myRole}/runes/${championId}.json`,
      content: JSON.stringify(exportObj),
    });
  }

  return { files, skippedRunePages: skipped };
}
