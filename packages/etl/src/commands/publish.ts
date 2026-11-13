/**
 * @draftorb/etl — `publish` command (D-091, T-128): local state publisher.
 *
 * Creates a `state-<UTC yyyymmddThhmmssZ>` release in the private state repo
 * via the `gh` CLI (the user's own auth — no token handling, no new
 * dependency). Two asset tiers per D-091:
 *   - `public-exports.tar.gz` always (small; keeps `pnpm etl pull` working),
 *   - `DraftOrb.sqlite.gz` only with `--db` (periodic backups; the DB is
 *     ~475 MiB gzipped, near the asset cap — never publish it every run).
 * Old `state-*` releases are pruned to `--keep` (default 8, 0 disables).
 */

import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import Database from 'better-sqlite3';

import { CliError, UsageError } from '../cli-args';
import { defaultPublicDataDir, resolveDbPath, resolveRepoRoot } from '../config/paths';
import {
  DB_ASSET_NAME,
  EXPORTS_ASSET_NAME,
  ghReady,
  listStateReleases,
  resolveStateRepo,
  STATE_RELEASE_TAG_PATTERN,
} from '../state-release';
import { createTarGz } from '../tar-create';
import { log, type Command } from './shared';

const USAGE = 'publish [--db] [--vacuum] [--repo=owner/name] [--note=text] [--keep=N]';

interface PublishOptions {
  withDb: boolean;
  vacuum: boolean;
  repo?: string;
  note?: string;
  keep: number;
}

function parsePublishArgs(args: string[]): PublishOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        db: { type: 'boolean', default: false },
        vacuum: { type: 'boolean', default: false },
        repo: { type: 'string' },
        note: { type: 'string' },
        keep: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl ${USAGE}`);
  }
  const keepRaw = parsed.values.keep;
  const keepText = typeof keepRaw === 'string' ? keepRaw : undefined;
  const keep = keepText === undefined ? 8 : Number.parseInt(keepText, 10);
  if (!Number.isInteger(keep) || keep < 0) {
    throw new UsageError(`Invalid --keep value "${keepRaw}".\nUsage: etl ${USAGE}`);
  }
  return {
    withDb: parsed.values.db === true,
    vacuum: parsed.values.vacuum === true,
    repo: typeof parsed.values.repo === 'string' ? parsed.values.repo : undefined,
    note: typeof parsed.values.note === 'string' ? parsed.values.note : undefined,
    keep,
  };
}

function gh(args: readonly string[]): void {
  try {
    execFileSync('gh', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: unknown) {
    const stderr =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : '';
    const detail = stderr.trim().split('\n').pop() ?? '';
    throw new CliError(
      `gh CLI call failed: gh ${args.slice(0, 2).join(' ')}` + (detail ? ` — ${detail}` : ''),
    );
  }
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

function stateTag(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `state-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`
  );
}

/** Checkpoint + integrity-check (+ optional VACUUM) the DB, then stream-gzip it. */
async function backupDatabase(dbPath: string, vacuum: boolean, dest: string): Promise<void> {
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 30000');
    db.pragma('wal_checkpoint(TRUNCATE)');
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
      throw new CliError(`PRAGMA integrity_check failed: ${JSON.stringify(rows)}`);
    }
    if (vacuum) db.exec('VACUUM');
  } finally {
    db.close();
  }
  await pipeline(createReadStream(dbPath), createGzip({ level: 9 }), createWriteStream(dest));
}

async function runPublish(args: string[]): Promise<void> {
  const options = parsePublishArgs(args);
  const ready = ghReady();
  if (!ready.ok) throw new CliError(ready.problem ?? 'gh CLI is not ready.');

  const originUrl = (() => {
    try {
      return execFileSync('git', ['remote', 'get-url', 'origin'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        cwd: resolveRepoRoot(),
      }).trim();
    } catch {
      return '';
    }
  })();
  const ownerMatch = /[:/]([^/\s:]+)\/[^/\s:]+(?:\.git)?\/?$/.exec(originUrl);
  const repo = resolveStateRepo(options.repo, process.env, ownerMatch?.[1]);

  const tag = stateTag();
  const existing = listStateReleases(repo).map((r) => r.tag);
  if (existing.includes(tag)) {
    throw new CliError(`Release tag ${tag} already exists; retry in a second.`);
  }

  const workDir = join(tmpdir(), `draftorb-publish-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  const assets: string[] = [];
  try {
    // 1. exports tarball
    const publicDir = defaultPublicDataDir();
    if (!existsSync(publicDir)) {
      throw new CliError(`No exports at ${publicDir}; run \`pnpm etl export\` first.`);
    }
    const entries = [...walkFiles(publicDir)].map((file) => ({
      name: `public/${relative(publicDir, file).split(sep).join('/')}`,
      data: readFileSync(file),
    }));
    const exportsPath = join(workDir, EXPORTS_ASSET_NAME);
    writeFileSync(exportsPath, createTarGz(entries));
    assets.push(exportsPath);
    log.info(`Packed ${entries.length} export file(s) into ${EXPORTS_ASSET_NAME}`);

    // 2. optional DB backup
    if (options.withDb) {
      const dbPath = resolveDbPath();
      if (!existsSync(dbPath)) throw new CliError(`No database at ${dbPath}.`);
      log.info('Checkpointing, verifying and gzipping the database (this can take a while)...');
      const gzPath = join(workDir, DB_ASSET_NAME);
      await backupDatabase(dbPath, options.vacuum, gzPath);
      assets.push(gzPath);
      log.info(`Database backup written (${(statSync(gzPath).size / 1048576).toFixed(0)} MiB)`);
    }

    // 3. create release
    const note = options.note ?? (options.withDb ? 'exports + DB backup' : 'exports only');
    gh(['release', 'create', tag, '--repo', repo, '--title', tag, '--notes', note, ...assets]);
    log.info(`Published ${tag} to ${repo} (${assets.length} asset(s))`);

    // 4. prune old state releases
    if (options.keep > 0) {
      const releases = listStateReleases(repo)
        .map((r) => r.tag)
        .filter((t) => STATE_RELEASE_TAG_PATTERN.test(t))
        .sort();
      const excess = releases.slice(0, Math.max(0, releases.length - options.keep));
      for (const old of excess) {
        gh(['release', 'delete', old, '--repo', repo, '--yes']);
        log.info(`Pruned old release ${old}`);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export const publishCommand: Command = {
  name: 'publish',
  usage: USAGE,
  description:
    'Publish data/public exports (and optionally a DB backup) as a state-* release ' +
    'in the private state repo via gh (D-091). --db adds DraftOrb.sqlite.gz; ' +
    '--vacuum compacts the DB first; --keep prunes old state releases (default 8).',
  run: runPublish,
};
