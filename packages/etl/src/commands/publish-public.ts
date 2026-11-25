/**
 * @draftorb/etl — `publish-public` command (BL-004, D-111): packs the shared
 * aggregates (`data/public/latest.json` + `data/public/<patch>/` plus the
 * manual `data/manual/champion-tags.json` at the archive root) into a
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
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { latestSchema, manifestSchema } from '@draftorb/shared';

import { CliError, UsageError } from '../cli-args';
import { defaultPublicDataDir, resolveRepoRoot } from '../config/paths';
import { ghReady } from '../state-release';
import { createTarGz, type TarFileEntry } from '../tar-create';
import { execGh, log, originRepoSlug, walkFiles, type Command } from './shared';

const USAGE = 'publish-public [--repo=owner/name] [--tag=data-latest] [--dry-run] [--out=path]';

export const PUBLIC_RELEASE_TAG = 'data-latest';
export const PUBLIC_ASSET_NAME = 'aggregates.tar.gz';

/** PUUID heuristic mirrored from scripts/check-secrets.mjs (BL-008): exactly
 * 78 base64url chars with at least one letter and one digit, bounded so
 * base64 integrity-hash segments never match. Keep in sync with that script
 * and with scripts/check-public-paths.mjs (the path-level twin). */
const PUUID_PATTERN = /(?<![A-Za-z0-9_+/-])[A-Za-z0-9_-]{78}(?![A-Za-z0-9_+/=-])/g;
/** Canonical dashed UUID form of a PUUID (8-4-4-4-12 hex). */
const PUUID_DASHED_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
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

/**
 * Path-level exclusion for the public artifact: any `profiles/` directory
 * segment or SQLite file name. Mirrors scripts/check-public-paths.mjs —
 * keep the two rules in sync.
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
  if (PUUID_DASHED_PATTERN.test(text)) violations.push('PUUID-like identifier');
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

/** JSON.parse that yields undefined on malformed input so zod reports the
 * validation error instead of a raw SyntaxError escaping. */
function readJsonLenient(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Lists the publishable set under `publicDir`: `latest.json` plus the tree
 * of the patch it selects (other patches and root-level reports are not
 * packed), minus forbidden paths. Throws when `latest.json` is invalid, the
 * patch dir is missing, or the manifest it points to is missing, invalid or
 * for another patch (e.g. invalidated by a same-patch `pnpm etl static`).
 */
export function collectPublishFiles(publicDir: string): PublishFile[] {
  const latestPath = join(publicDir, 'latest.json');
  if (!existsSync(latestPath)) {
    throw new CliError(`No latest.json at ${publicDir}; run \`pnpm etl export\` first.`);
  }
  const latestResult = latestSchema.safeParse(readJsonLenient(latestPath));
  if (!latestResult.success) {
    throw new CliError(`latest.json is invalid: ${latestPath}; run \`pnpm etl export\`.`);
  }
  const latest = latestResult.data;
  const patchDir = join(publicDir, latest.patch);
  if (!existsSync(patchDir)) {
    throw new CliError(
      `Patch dir ${latest.patch}/ missing from ${publicDir}; run \`pnpm etl export ${latest.patch}\`.`,
    );
  }
  const files: PublishFile[] = [
    { rel: 'latest.json', abs: latestPath, size: statSync(latestPath).size },
  ];
  for (const abs of walkFiles(patchDir)) {
    const rel = relative(publicDir, abs).split(sep).join('/');
    if (isForbiddenPublishPath(rel)) continue;
    files.push({ rel, abs, size: statSync(abs).size });
  }
  const manifestFile = files.find((f) => f.rel === latest.manifest);
  const rerun = `run \`pnpm etl export ${latest.patch}\``;
  if (manifestFile === undefined) {
    throw new CliError(`Manifest ${latest.manifest} missing from ${publicDir}; ${rerun}.`);
  }
  const manifest = manifestSchema.safeParse(readJsonLenient(manifestFile.abs));
  if (!manifest.success || manifest.data.patch !== latest.patch) {
    throw new CliError(
      `Manifest ${latest.manifest} is invalid or not for ${latest.patch}; ${rerun}.`,
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

/** Archive-root files the desktop surfaces as patch/freshness: they sit next
 * to `latest.json` in the tarball, outside the `<patch>/` tree the on-disk
 * manifest lists. */
const ARCHIVE_ROOT_FILES = ['latest.json', 'champion-tags.json'] as const;

/**
 * Returns tar entries whose manifest copy also lists the archive-root files.
 *
 * The on-disk `<patch>/manifest.json` only covers files under `<patch>/`, but
 * the tarball also carries `latest.json` and `champion-tags.json` at the root
 * — the very files the app displays as patch and freshness. The manifest copy
 * inside the archive therefore gains one entry per root file, pathed
 * `/name` (archive-relative) to stay unambiguous beside the patch-relative
 * paths. `manifest.json` itself stays the trust root and is not self-listed;
 * the desktop loader rejects any tar entry the manifest does not cover.
 */
export function augmentManifestWithRootFiles(entries: readonly TarFileEntry[]): TarFileEntry[] {
  const manifestIndex = entries.findIndex((e) => /(^|\/)manifest\.json$/.test(e.name));
  if (manifestIndex === -1) {
    throw new CliError('publish set has no manifest.json to augment');
  }
  const manifestEntry = entries[manifestIndex];
  if (manifestEntry === undefined) throw new CliError('publish set has no manifest.json');
  const manifest = manifestSchema.parse(JSON.parse(manifestEntry.data.toString('utf8')));
  const rootEntries = ARCHIVE_ROOT_FILES.map((name) => {
    const entry = entries.find((e) => e.name === name);
    if (entry === undefined) throw new CliError(`publish set is missing ${name}`);
    return {
      path: `/${name}`,
      sha256: createHash('sha256').update(entry.data).digest('hex'),
    };
  });
  const merged = manifestSchema.parse({
    ...manifest,
    files: [...manifest.files, ...rootEntries].sort((a, b) => a.path.localeCompare(b.path)),
  });
  const data = Buffer.from(JSON.stringify(merged, null, 2), 'utf8');
  return entries.map((e, i) => (i === manifestIndex ? { ...e, data } : e));
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

async function runPublishPublic(args: string[]): Promise<void> {
  const options = parsePublishPublicArgs(args);
  const publicDir = defaultPublicDataDir();
  if (!existsSync(publicDir)) {
    throw new CliError(`No exports at ${publicDir}; run \`pnpm etl export\` first.`);
  }

  const files = collectPublishFiles(publicDir);
  // Manual champion tags are public curated data the engine needs
  // (`RecommendData.tags`); they live outside data/public, at the archive root.
  const tagsPath = join(resolveRepoRoot(), 'data', 'manual', 'champion-tags.json');
  if (!existsSync(tagsPath)) {
    throw new CliError(`Missing manual champion tags at ${tagsPath}.`);
  }
  files.push({
    rel: 'champion-tags.json',
    abs: tagsPath,
    size: statSync(tagsPath).size,
  });
  const violations = scanPublishSet(files);
  if (violations.length > 0) {
    throw new CliError(
      `Publishable set failed the safety scan; refusing to publish:\n  - ${violations.join('\n  - ')}`,
    );
  }

  const entries = augmentManifestWithRootFiles(toTarEntries(files));
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

  // Stage under a fresh temp dir: the uploaded file is always the literal
  // `aggregates.tar.gz` (gh runs with cwd=stagingDir), so --out can neither
  // rename the asset nor smuggle a `#label` suffix into gh's path parsing.
  const stagingDir = mkdtempSync(join(tmpdir(), 'draftorb-public-'));
  try {
    const treeDir = join(stagingDir, 'tree');
    for (const file of files) {
      const target = join(treeDir, ...file.rel.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file.abs, target);
    }
    runPublicPathsCheck(treeDir);

    writeFileSync(join(stagingDir, PUBLIC_ASSET_NAME), tarball);
    if (options.out !== undefined) {
      mkdirSync(dirname(options.out), { recursive: true });
      writeFileSync(options.out, tarball);
      log.info(`Artifact written to ${options.out}`);
    }

    if (options.dryRun) {
      log.info('Dry run: nothing uploaded.');
      return;
    }
    publishStaged(stagingDir, options);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

/** Mandatory privacy gate (WORKFLOW.md): scripts/check-public-paths.mjs --dir. */
function runPublicPathsCheck(dir: string): void {
  const script = join(resolveRepoRoot(), 'scripts', 'check-public-paths.mjs');
  try {
    execFileSync(process.execPath, [script, '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: unknown) {
    const out =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '').trim()
        : '';
    throw new CliError(`check-public-paths failed; refusing to publish.${out ? `\n${out}` : ''}`);
  }
}

function publishStaged(stagingDir: string, options: PublishPublicOptions): void {
  const ready = ghReady();
  if (!ready.ok) throw new CliError(ready.problem ?? 'gh CLI is not ready.');
  const repo = options.repo ?? originRepoSlug();
  if (repo === undefined || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new UsageError(
      'Cannot determine the public repo. Pass --repo=owner/name (it must be the PUBLIC repo, not the state repo).',
    );
  }

  const notes =
    'Public shared aggregates for DraftOrb (D-111): latest.json + the patch export tree. ' +
    'No profiles/, no SQLite, no credentials. Regenerate with `pnpm etl publish-public`.';
  if (releaseExists(repo, options.tag)) {
    execGh(
      ['release', 'upload', options.tag, PUBLIC_ASSET_NAME, '--repo', repo, '--clobber'],
      stagingDir,
    );
    log.info(`Updated asset ${PUBLIC_ASSET_NAME} on release ${options.tag} in ${repo}`);
  } else {
    execGh(
      [
        'release',
        'create',
        options.tag,
        PUBLIC_ASSET_NAME,
        '--repo',
        repo,
        '--title',
        'Public aggregates',
        '--notes',
        notes,
      ],
      stagingDir,
    );
    log.info(`Created release ${options.tag} in ${repo}`);
  }
}

export const publishPublicCommand: Command = {
  name: 'publish-public',
  usage: USAGE,
  description:
    'Pack data/public aggregates (no profiles/) into aggregates.tar.gz and publish ' +
    'it on the public repo release (default rolling tag data-latest). --dry-run builds ' +
    'the artifact and runs the safety scan without uploading.',
  run: runPublishPublic,
};
