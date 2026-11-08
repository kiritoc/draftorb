/**
 * @draftorb/etl — State release helpers for `pnpm etl pull` (T-108, D-078/D-079).
 *
 * The scheduled ETL publishes its SQLite database and the `data/public`
 * exports as assets of `state-<UTC yyyymmddThhmmZ>` releases in a private
 * GitHub repo (default `draftorb-state`). `pull` downloads the newest such
 * release with the `gh` CLI — no new dependency, no token handling of its
 * own (gh uses the user's own auth).
 */

import { execFileSync } from 'node:child_process';

import { CliError, UsageError } from './cli-args';

export const STATE_RELEASE_TAG_PATTERN = /^state-\d{8}T\d{4}Z$/;
export const EXPORTS_ASSET_NAME = 'public-exports.tar.gz';
export const DB_ASSET_NAME = 'DraftOrb.sqlite.gz';
export const DEFAULT_STATE_REPO_NAME = 'draftorb-state';
export const STATE_REPO_ENV = 'DRAFTORB_STATE_REPO';

/**
 * Picks the newest `state-<UTC yyyymmddThhmmZ>` tag from a release tag list.
 * The fixed-width timestamp makes lexicographic order chronological; other
 * `state-*` tags are ignored.
 */
export function pickNewestStateTag(tags: readonly string[]): string | null {
  const stateTags = tags.filter((tag) => STATE_RELEASE_TAG_PATTERN.test(tag)).sort();
  return stateTags.length > 0 ? (stateTags[stateTags.length - 1] ?? null) : null;
}

export interface StateReleaseSummary {
  readonly tag: string;
  readonly assets: readonly string[];
}

/**
 * Picks the newest `state-*` tag whose release carries `requiredAsset`.
 * A failed pipeline run publishes a DB-only release (D-078); pull must skip
 * those so it never restores exports from a release that has none.
 */
export function pickNewestStateTagWithAssets(
  releases: readonly StateReleaseSummary[],
  requiredAsset: string,
): string | null {
  const tags = releases
    .filter(
      (release) =>
        STATE_RELEASE_TAG_PATTERN.test(release.tag) && release.assets.includes(requiredAsset),
    )
    .map((release) => release.tag)
    .sort();
  return tags.length > 0 ? (tags[tags.length - 1] ?? null) : null;
}

/** `owner/name` validation for --repo / DRAFTORB_STATE_REPO values. */
export function isValidRepoSlug(value: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
}

/**
 * Resolves the state repo slug (`owner/name`). A bare repo name is resolved
 * under the owner of the current git checkout's `origin` remote; a full
 * `owner/name` is used as-is. `explicit` (--repo) wins over
 * DRAFTORB_STATE_REPO, which wins over the default name.
 */
export function resolveStateRepo(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  originOwner?: string,
): string {
  const candidate = explicit ?? env[STATE_REPO_ENV] ?? DEFAULT_STATE_REPO_NAME;
  if (candidate.includes('/')) {
    if (!isValidRepoSlug(candidate)) {
      throw new UsageError(
        `Invalid state repo "${candidate}". Expected "owner/name" or a bare repo name.`,
      );
    }
    return candidate;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(candidate)) {
    throw new UsageError(`Invalid state repo name "${candidate}". Expected a GitHub repo name.`);
  }
  if (originOwner === undefined || originOwner === '') {
    throw new UsageError(
      `Cannot determine the repository owner for state repo "${candidate}". ` +
        'Pass --repo=owner/name or set DRAFTORB_STATE_REPO.',
    );
  }
  return `${originOwner}/${candidate}`;
}

/** Extracts `owner` from a git remote URL (https or ssh form). */
export function parseOriginOwner(remoteUrl: string): string | undefined {
  const match = /[:/]([^/\s:]+)\/[^/\s:]+(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match?.[1];
}

function runGh(args: readonly string[]): string {
  try {
    return execFileSync('gh', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : '';
    const detail = stderr.trim().split('\n').pop() ?? '';
    throw new CliError(
      `gh CLI call failed: gh ${args[0] ?? ''} ${args[1] ?? ''}` + (detail ? ` — ${detail}` : ''),
    );
  }
}

/** True when the `gh` binary exists and is authenticated. */
export function ghReady(): { ok: boolean; problem?: string } {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
  } catch {
    return {
      ok: false,
      problem:
        'The gh CLI is not installed. Install the GitHub CLI and run `gh auth login`, ' +
        'then retry `pnpm etl pull`.',
    };
  }
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  } catch {
    return {
      ok: false,
      problem:
        'The gh CLI is not authenticated. Run `gh auth login` (the account needs ' +
        'read access to the private state repo), then retry `pnpm etl pull`.',
    };
  }
  return { ok: true };
}

/** Lists release tag names of a repo via the gh CLI. */
export function listReleaseTags(repo: string, limit = 100): string[] {
  return listStateReleases(repo, limit).map((release) => release.tag);
}

/** Lists releases (tag + asset names) of a repo via the gh CLI. */
export function listStateReleases(repo: string, limit = 100): StateReleaseSummary[] {
  const out = runGh([
    'release',
    'list',
    '--repo',
    repo,
    '--limit',
    String(limit),
    '--json',
    'tagName,assets',
  ]);
  const parsed = JSON.parse(out) as Array<{ tagName?: unknown; assets?: unknown }>;
  return parsed.flatMap((release) => {
    if (typeof release.tagName !== 'string') return [];
    const assets = Array.isArray(release.assets)
      ? release.assets.flatMap((asset) => {
          const name =
            asset !== null && typeof asset === 'object'
              ? (asset as { name?: unknown }).name
              : undefined;
          return typeof name === 'string' ? [name] : [];
        })
      : [];
    return [{ tag: release.tagName, assets }];
  });
}

/**
 * Downloads release assets matching `patterns` into `dir`. Fails with a
 * clear message when the tag or an asset is missing.
 */
export function downloadReleaseAssets(
  repo: string,
  tag: string,
  dir: string,
  patterns: readonly string[],
): void {
  const args = ['release', 'download', tag, '--repo', repo, '--dir', dir, '--clobber'];
  for (const pattern of patterns) args.push('--pattern', pattern);
  try {
    execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : '';
    const detail = stderr.trim().split('\n').pop() ?? '';
    throw new CliError(
      `Could not download ${patterns.join(', ')} from release ${tag} in ${repo}` +
        (detail ? ` — ${detail}` : ''),
    );
  }
}
