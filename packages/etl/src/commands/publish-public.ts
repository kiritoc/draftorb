/**
 * @draftorb/etl — `publish-public` command (BL-004, D-111): packs the shared
 * aggregates (`data/public/latest.json` + `data/public/<patch>/`) into a
 * single tar.gz and publishes it as a release asset on the PUBLIC repo, so
 * the desktop app can download data at launch with no token.
 *
 * `profiles/` and any SQLite file are excluded and the publishable set is
 * scanned for PUUID-like identifiers before packing — the public artifact
 * must never carry private data (AUDIT §5e, scripts/check-public-paths.mjs).
 *
 * The release uses a rolling tag (`data-latest` by default): each publish
 * replaces the asset, so `releases/download/data-latest/aggregates.tar.gz`
 * is a stable URL for the app. `--dry-run` builds and scans the artifact
 * without touching GitHub.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { CliError, UsageError } from '../cli-args';
import { defaultPublicDataDir, resolveRepoRoot } from '../config/paths';
import { ghReady } from '../state-release';
import { createTarGz, type TarFileEntry } from '../tar-create';
import { log, type Command } from './shared';

const USAGE = 'publish-public [--repo=owner/name] [--tag=data-latest] [--dry-run] [--out=path]';

export const PUBLIC_RELEASE_TAG = 'data-latest';
export const PUBLIC_ASSET_NAME = 'aggregates.tar.gz';

/** Same PUUID heuristic as scripts/check-secrets.mjs (BL-008): exactly 78
 * base64url chars with at least one letter and one digit, bounded so base64
 * integrity-hash segments never match. */
const PUUID_PATTERN = /(?<![A-Za-z0-9_+/-])[A-Za-z0-9_-]{78}(?![A-Za-z0-9_+/=-])/g;
const RIOT_KEY_PATTERN = /RGAPI-[A-Za-z0-9]{16,}/;
const SQLITE_FILE = /\.(sqlite3?|db)(\.gz)?$|\.sqlite-(wal|shm)$/;
/** Aggregate JSON is text; cap the scan so a stray huge file cannot stall it. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

interface PublishPublicOptions {
  repo?: string;
  tag: string;
  dryRun: boolean;
  out?: string;
}

export function parsePublishPublicArgs(args: string[]): PublishPublicOptions {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        repo: { type: 'string' },
        tag: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        out: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`${message}\nUsage: etl ${USAGE}`);
  }
  const { values } = parsed;
  return {
    repo: typeof values.repo === 'string' ? values.repo : undefined,
    tag: typeof values.tag === 'string' ? values.tag : PUBLIC_RELEASE_TAG,
    dryRun: values['dry-run'] === true,
    out: typeof values.out === 'string' ? values.out : undefined,
  };
}

/** `owner/name` from an https or ssh git remote URL. */
export function parseOriginRepo(remoteUrl: string): string | undefined {
  const match = /[:/]([^/\s:]+)\/([^/\s:]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * Path-level exclusion for the public artifact: any `profiles/` directory
 * segment or SQLite file name (mirrors scripts/check-public-paths.mjs).
 */
export function isForbiddenPublishPath(relPath: string): boolean {
  const segments = relPath.replace(/\\/g, '/').split('/');
  const base = segments[segments.length - 1] ?? '';
  return segments.slice(0, -1).includes('profiles') || SQLITE_FILE.test(base);
}

/** Content-level scan: PUUID-like tokens and Riot key patterns. */
export function findSecretViolations(text: string): string[] {
  const violations: string[] = [];
  if (RIOT_KEY_PATTERN.test(text)) violations.push('RGAPI- key pattern');
  for (const [token] of text.matchAll(PUUID_PATTERN)) {
    if (/[A-Za-z]/.test(token) && /[0-9]/.test(token)) {
      violations.push('PUUID-like identifier');
      break;
    }
  }
  return violations;
}

export interface PublishFile {
  /** Path relative to `data/public`, posix separators. */
  rel: string;
  abs: string;
  size: number;
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Lists the publishable set under `publicDir`: `latest.json` plus the patch
 * tree, minus forbidden paths. Throws when `latest.json` or its patch dir
 * is missing.
 */
export function collectPublishFiles(publicDir: string): PublishFile[] {
  const latestPath = join(publicDir, 'latest.json');
  if (!existsSync(latestPath)) {
    throw new CliError(`No latest.json at ${publicDir}; run \`pnpm etl export\` first.`);
  }
  const latest = JSON.parse(readFileSync(latestPath, 'utf8')) as { patch?: string };
  if (typeof latest.patch !== 'string' || latest.patch === '') {
    throw new CliError(`latest.json has no patch label: ${latestPath}`);
  }
  const files: PublishFile[] = [];
  for (const abs of walkFiles(publicDir)) {
    const rel = relative(publicDir, abs).split(sep).join('/');
    if (isForbiddenPublishPath(rel)) continue;
    files.push({ rel, abs, size: statSync(abs).size });
  }
  if (!files.some((f) => f.rel === 'latest.json')) {
    throw new CliError(`latest.json missing from the publishable set: ${publicDir}`);
  }
  if (!files.some((f) => f.rel.startsWith(`${latest.patch}/`))) {
    throw new CliError(
      `Patch dir ${latest.patch}/ missing from ${publicDir}; run \`pnpm etl export ${latest.patch}\`.`,
    );
  }
  return files;
}

/**
 * Scans the publishable set. Returns violation strings `rel: needle`;
 * an empty array means safe to publish.
 */
export function scanPublishSet(files: readonly PublishFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (isForbiddenPublishPath(file.rel)) {
      violations.push(`${file.rel}: forbidden path`);
      continue;
    }
    if (file.size > MAX_SCAN_BYTES) {
      violations.push(`${file.rel}: exceeds ${MAX_SCAN_BYTES} scan cap`);
      continue;
    }
    const text = readFileSync(file.abs, 'utf8');
    for (const needle of findSecretViolations(text)) {
      violations.push(`${file.rel}: ${needle}`);
    }
  }
  return violations;
}

/** tar entries mirroring `data/public` layout minus forbidden paths. */
export function toTarEntries(files: readonly PublishFile[]): TarFileEntry[] {
  return files.map((file) => ({ name: file.rel, data: readFileSync(file.abs) }));
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

function releaseExists(repo: string, tag: string): boolean {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', repo], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function originRepo(): string | undefined {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: resolveRepoRoot(),
    }).trim();
    return parseOriginRepo(url);
  } catch {
    return undefined;
  }
}

async function runPublishPublic(args: string[]): Promise<void> {
  const options = parsePublishPublicArgs(args);
  const publicDir = defaultPublicDataDir();
  if (!existsSync(publicDir)) {
    throw new CliError(`No exports at ${publicDir}; run \`pnpm etl export\` first.`);
  }

  const files = collectPublishFiles(publicDir);
  const violations = scanPublishSet(files);
  if (violations.length > 0) {
    throw new CliError(
      `Publishable set failed the safety scan; refusing to publish:\n  - ${violations.join('\n  - ')}`,
    );
  }

  const entries = toTarEntries(files);
  const tarball = createTarGz(entries);
  const treeBytes = files.reduce((sum, f) => sum + f.size, 0);
  log.info(
    `Packed ${entries.length} file(s), ${(treeBytes / 1048576).toFixed(1)} MiB tree -> ` +
      `${PUBLIC_ASSET_NAME} (${(tarball.length / 1048576).toFixed(1)} MiB)`,
  );
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
  for (const f of largest) {
    log.detail(`${f.rel}: ${(f.size / 1048576).toFixed(2)} MiB`);
  }

  let tempDir: string | undefined;
  const dest =
    options.out ??
    (() => {
      tempDir = mkdtempSync(join(tmpdir(), 'draftorb-public-'));
      return join(tempDir, PUBLIC_ASSET_NAME);
    })();
  if (options.out !== undefined) mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(dest, tarball);
  log.info(`Artifact written to ${dest}`);

  if (options.dryRun) {
    log.info('Dry run: nothing uploaded.');
    return;
  }

  const ready = ghReady();
  if (!ready.ok) throw new CliError(ready.problem ?? 'gh CLI is not ready.');
  const repo = options.repo ?? originRepo();
  if (repo === undefined || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new UsageError(
      'Cannot determine the public repo. Pass --repo=owner/name (it must be the PUBLIC repo, not the state repo).',
    );
  }

  const notes =
    'Public shared aggregates for DraftOrb (D-111): latest.json + the patch export tree. ' +
    'No profiles/, no SQLite, no credentials. Regenerate with `pnpm etl publish-public`.';
  if (releaseExists(repo, options.tag)) {
    gh(['release', 'upload', options.tag, dest, '--repo', repo, '--clobber']);
    log.info(`Updated asset ${PUBLIC_ASSET_NAME} on release ${options.tag} in ${repo}`);
  } else {
    gh([
      'release',
      'create',
      options.tag,
      dest,
      '--repo',
      repo,
      '--title',
      'Public aggregates',
      '--notes',
      notes,
    ]);
    log.info(`Created release ${options.tag} in ${repo}`);
  }
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
}

export const publishPublicCommand: Command = {
  name: 'publish-public',
  usage: `etl ${USAGE}`,
  description:
    'Pack data/public aggregates (no profiles/) into aggregates.tar.gz and publish ' +
    'it on the public repo release (default rolling tag data-latest). --dry-run builds ' +
    'the artifact and runs the safety scan without uploading.',
  run: runPublishPublic,
};
