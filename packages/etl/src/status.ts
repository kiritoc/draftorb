import type Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Platform } from './riot';

export interface MigrationStatusSummary {
  applied: number;
  pending: number;
  missingVersions: string[];
}

export interface PlayerTierCount {
  platform: string;
  tier: string;
  count: number;
}

export interface MatchPatchCount {
  platform: string;
  patch: string;
  count: number;
  rankKnownCount1?: number;
}

export interface PlatformCursorCount {
  platform: string;
  done: number;
  partial: number;
}

export interface RejectReasonCount {
  reason: string;
  count: number;
}

export interface EtlStatus {
  migrations: MigrationStatusSummary;
  players: PlayerTierCount[];
  matches: MatchPatchCount[];
  participants: number;
  cursors: PlatformCursorCount[];
  rejects: RejectReasonCount[];
  /** Suggested data breakpoints awaiting review (SPECS §16). */
  breakpointsReviewNeeded: number;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) !==
    undefined
  );
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.pragma(`table_info(${tableName})`) as { name: string }[];
  return columns.some((col) => col.name === columnName);
}

function getDiskMigrationVersions(): string[] {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => f.replace('.sql', ''));
}

function getReadOnlyMigrationStatus(db: Database.Database): MigrationStatusSummary {
  const diskVersions = getDiskMigrationVersions();
  if (!tableExists(db, '_migrations')) {
    return { applied: 0, pending: diskVersions.length, missingVersions: [] };
  }

  const appliedRows = db.prepare('SELECT version FROM _migrations ORDER BY version').all() as {
    version: string;
  }[];
  const appliedVersions = appliedRows.map((r) => r.version);
  const appliedSet = new Set(appliedVersions);
  const diskSet = new Set(diskVersions);

  return {
    applied: appliedVersions.length,
    pending: diskVersions.filter((v) => !appliedSet.has(v)).length,
    missingVersions: appliedVersions.filter((v) => !diskSet.has(v)),
  };
}

/**
 * Returns summary counts and migration status from the ETL database.
 * Purely read-only, using parameterized SQL queries.
 */
export function getEtlStatus(db: Database.Database, platform?: Platform | string): EtlStatus {
  const migrations = getReadOnlyMigrationStatus(db);

  let players: PlayerTierCount[] = [];
  if (tableExists(db, 'players')) {
    const where = platform !== undefined ? 'WHERE platform = ?' : '';
    players = db
      .prepare(
        `SELECT platform, tier, COUNT(*) AS count
         FROM players ${where}
         GROUP BY platform, tier ORDER BY platform, tier`,
      )
      .all(...(platform !== undefined ? [platform] : [])) as PlayerTierCount[];
  }

  let matches: MatchPatchCount[] = [];
  if (tableExists(db, 'matches')) {
    interface MatchRow {
      platform: string;
      patch: string;
      count: number;
      rank_known_count_1: number | null;
    }
    const hasRankKnown = columnExists(db, 'matches', 'rank_known_count');
    const rankKnownSelect = hasRankKnown
      ? 'SUM(CASE WHEN rank_known_count = 1 THEN 1 ELSE 0 END)'
      : 'NULL';
    const where = platform !== undefined ? 'WHERE platform = ?' : '';
    const rows = db
      .prepare(
        `SELECT platform, patch, COUNT(*) AS count, ${rankKnownSelect} AS rank_known_count_1
         FROM matches ${where}
         GROUP BY platform, patch ORDER BY platform, patch`,
      )
      .all(...(platform !== undefined ? [platform] : [])) as MatchRow[];

    matches = rows.map((r) => ({
      platform: r.platform,
      patch: r.patch,
      count: r.count,
      ...(r.rank_known_count_1 !== null ? { rankKnownCount1: Number(r.rank_known_count_1) } : {}),
    }));
  }

  let participants = 0;
  if (tableExists(db, 'participants')) {
    interface CountRow {
      count: number;
    }
    let row: CountRow | undefined;
    if (platform !== undefined && tableExists(db, 'matches')) {
      row = db
        .prepare(
          `SELECT COUNT(*) AS count FROM participants p
           JOIN matches m ON p.match_id = m.match_id WHERE m.platform = ?`,
        )
        .get(platform) as CountRow | undefined;
    } else {
      row = db.prepare('SELECT COUNT(*) AS count FROM participants').get() as CountRow | undefined;
    }
    participants = Number(row?.count ?? 0);
  }

  let cursors: PlatformCursorCount[] = [];
  if (tableExists(db, 'ingest_state')) {
    interface IngestRow {
      key: string;
      value: string;
    }
    const where = platform !== undefined ? 'WHERE key LIKE ?' : "WHERE key LIKE 'match-ingest:%'";
    const params = platform !== undefined ? [`match-ingest:${platform}:%`] : [];
    const rows = db
      .prepare(`SELECT key, value FROM ingest_state ${where} ORDER BY key`)
      .all(...params) as IngestRow[];

    const platformMap = new Map<string, { done: number; partial: number }>();
    for (const row of rows) {
      const parts = row.key.split(':');
      if (parts.length < 3 || parts[0] !== 'match-ingest') continue;
      const rowPlatform = parts[1];
      if (!rowPlatform) continue;
      let entry = platformMap.get(rowPlatform);
      if (!entry) {
        entry = { done: 0, partial: 0 };
        platformMap.set(rowPlatform, entry);
      }
      let isDone = false;
      try {
        const parsed = JSON.parse(row.value) as { status?: string };
        isDone = parsed?.status === 'done';
      } catch {
        isDone = false;
      }
      if (isDone) entry.done += 1;
      else entry.partial += 1;
    }

    cursors = Array.from(platformMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([plat, counts]) => ({
        platform: plat,
        done: counts.done,
        partial: counts.partial,
      }));
  }

  let rejects: RejectReasonCount[] = [];
  if (tableExists(db, 'match_rejects')) {
    rejects = db
      .prepare(
        'SELECT reason, COUNT(*) AS count FROM match_rejects GROUP BY reason ORDER BY reason',
      )
      .all() as RejectReasonCount[];
  }

  let breakpointsReviewNeeded = 0;
  if (tableExists(db, 'data_breakpoints')) {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM data_breakpoints WHERE status = 'suggested'")
      .get() as { count: number } | undefined;
    breakpointsReviewNeeded = Number(row?.count ?? 0);
  }

  return { migrations, players, matches, participants, cursors, rejects, breakpointsReviewNeeded };
}

/**
 * Pure formatter that turns an EtlStatus object into a human-readable multi-line string.
 */
export function formatEtlStatus(status: EtlStatus): string {
  const lines: string[] = [];

  const missingSuffix =
    status.migrations.missingVersions.length > 0
      ? ` (missing: ${status.migrations.missingVersions.join(', ')})`
      : '';
  lines.push(
    `Migrations: ${status.migrations.applied} applied, ${status.migrations.pending} pending${missingSuffix}`,
  );

  if (status.players.length === 0) {
    lines.push('Players: 0');
  } else {
    const totalPlayers = status.players.reduce((sum, p) => sum + p.count, 0);
    lines.push(`Players (${totalPlayers}):`);
    for (const p of status.players) {
      lines.push(`  ${p.platform} / ${p.tier}: ${p.count}`);
    }
  }

  if (status.matches.length === 0) {
    lines.push('Matches: 0');
  } else {
    const totalMatches = status.matches.reduce((sum, m) => sum + m.count, 0);
    lines.push(`Matches (${totalMatches}):`);
    for (const m of status.matches) {
      const rankSuffix =
        m.rankKnownCount1 !== undefined ? ` (${m.rankKnownCount1} with rank_known_count = 1)` : '';
      lines.push(`  ${m.platform} / ${m.patch}: ${m.count}${rankSuffix}`);
    }
  }

  lines.push(`Participants: ${status.participants}`);

  if (status.cursors.length === 0) {
    lines.push('Match cursors: 0');
  } else {
    lines.push('Match cursors:');
    for (const c of status.cursors) {
      lines.push(`  ${c.platform}: ${c.done} done, ${c.partial} partial`);
    }
  }

  if (status.rejects.length === 0) {
    lines.push('Rejects (global): 0');
  } else {
    const totalRejects = status.rejects.reduce((sum, r) => sum + r.count, 0);
    lines.push(`Rejects (global, ${totalRejects}):`);
    for (const r of status.rejects) {
      lines.push(`  ${r.reason}: ${r.count}`);
    }
  }

  lines.push(`Breakpoints pending review: ${status.breakpointsReviewNeeded}`);

  return lines.join('\n');
}
