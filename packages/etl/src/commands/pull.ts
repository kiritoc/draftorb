import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { CliError, UsageError } from '../cli-args';
import { defaultPublicDataDir, resolveDbPath } from '../config/paths';
import {
  DB_ASSET_NAME,
  EXPORTS_ASSET_NAME,
  downloadReleaseAssets,
  ghReady,
  listStateReleases,
  parseOriginOwner,
  pickNewestStateTagWithAssets,
  resolveStateRepo,
} from '../state-release';
import { extractTarGz } from '../tar-extract';
import { log, type Command } from './shared';

const USAGE = 'pull [--repo=owner/name] [--tag=state-YYYYMMDDTHHMM[SS]Z] [--db] [--dir=path]';

export interface PullOptions {
  repo?: string;
  tag?: string;
  withDb: boolean;
  dir?: string;
}

export function parsePullArgs(args: string[]): PullOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        repo: { type: 'string' },
        tag: { type: 'string' },
        db: { type: 'boolean', default: false },
        dir: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl ${USAGE}`);
  }
  const { values } = parsed;
  return {
    repo: typeof values.repo === 'string' ? values.repo : undefined,
    tag: typeof values.tag === 'string' ? values.tag : undefined,
    withDb: values.db === true,
    dir: typeof values.dir === 'string' ? values.dir : undefined,
  };
}

/** Owner of the `origin` remote, when the checkout has a GitHub remote. */
function originOwner(): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return parseOriginOwner(url);
  } catch {
    return undefined;
  }
}

async function runPull(args: string[]): Promise<void> {
  const options = parsePullArgs(args);

  const ready = ghReady();
  if (!ready.ok) {
    throw new CliError(ready.problem ?? 'gh CLI is not ready.');
  }

  const repo = resolveStateRepo(options.repo, process.env, originOwner());
  const workDir = mkdtempSync(join(tmpdir(), 'draftorb-pull-'));
  try {
    let tag = options.tag;
    if (tag === undefined) {
      // Newest release carrying the exports asset: a failed pipeline run
      // publishes a DB-only release that pull must skip (D-078/D-079).
      const releases = listStateReleases(repo);
      tag = pickNewestStateTagWithAssets(releases, EXPORTS_ASSET_NAME) ?? undefined;
      if (tag === undefined) {
        throw new CliError(
          `No state-* release with ${EXPORTS_ASSET_NAME} found in ${repo}. ` +
            'Seed the first release manually (see SETUP.md > Seeding the first ' +
            'state release) or pass --tag.',
        );
      }
    }
    log.info(`Downloading state release ${tag} from ${repo}...`);

    const patterns = options.withDb ? [EXPORTS_ASSET_NAME, DB_ASSET_NAME] : [EXPORTS_ASSET_NAME];
    downloadReleaseAssets(repo, tag, workDir, patterns);

    const archivePath = join(workDir, EXPORTS_ASSET_NAME);
    if (!existsSync(archivePath)) {
      throw new CliError(`Release ${tag} has no ${EXPORTS_ASSET_NAME} asset.`);
    }
    const targetDir = options.dir ?? defaultPublicDataDir();
    mkdirSync(targetDir, { recursive: true });
    const written = extractTarGz(readFileSync(archivePath), targetDir, {
      stripPrefix: 'public',
    });
    log.info(`Extracted ${written.length} file(s) into ${targetDir}`);

    if (options.withDb) {
      const dbAsset = join(workDir, DB_ASSET_NAME);
      if (!existsSync(dbAsset)) {
        throw new CliError(`Release ${tag} has no ${DB_ASSET_NAME} asset (--db requested).`);
      }
      const dbPath = resolveDbPath();
      writeFileSync(dbPath, gunzipSync(readFileSync(dbAsset)));
      log.info(`Database written to ${dbPath}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export const pullCommand: Command = {
  name: 'pull',
  usage: USAGE,
  description:
    'Download the newest state-* release exports into data/public via the gh CLI ' +
    '(D-079). --db also restores the SQLite database; --repo/--tag/DRAFTORB_STATE_REPO ' +
    'override the default <origin-owner>/draftorb-state repo and tag selection.',
  run: runPull,
};
