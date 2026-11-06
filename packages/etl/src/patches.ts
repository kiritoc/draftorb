/**
 * @draftorb/etl — Patch index table (D-043, SPECS §12).
 *
 * `patches` maps every released `major.minor` label to a stable ordinal
 * `patch_index` (oldest-first, append-only). The ordering source is Data
 * Dragon `versions.json` (newest-first, reversed here); version strings are
 * never compared for age — one parse (`gameVersion`/version -> `major.minor`
 * label) feeds the table, and all window/breakpoint logic uses `patch_index`.
 */

import type Database from 'better-sqlite3';

const DDRAGON_VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';

/** `major.minor` label, identical to `matches.patch` (RIOT_API.md). */
export const PATCH_LABEL_PATTERN = /^\d+\.\d+$/;

/**
 * Parses a Data Dragon / game version into its `major.minor` label.
 * Returns `null` for entries that are not `major.minor[.patch]` versions
 * (e.g. the legacy `lolpatch_7.20` entries in versions.json, D-043 note).
 */
export function parsePatchLabel(version: string): string | null {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version.trim());
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return `${match[1]}.${match[2]}`;
}

/**
 * Ordered `major.minor` labels from a `versions.json` payload (newest-first):
 * reversed to oldest-first, unparseable entries dropped, hotfixes sharing a
 * label collapsed to their oldest position. Season changes (14.x -> 15.x)
 * order by source position, never by numeric compare.
 */
export function parsePatchLabels(versions: readonly string[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const version of [...versions].reverse()) {
    const label = parsePatchLabel(version);
    if (label === null || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/** Fetches the raw `versions.json` array (newest-first) from Data Dragon. */
export async function fetchPatchVersions(fetchFn: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchFn(DDRAGON_VERSIONS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Data Dragon versions: HTTP ${res.status} ${res.statusText}`);
  }
  const versions = (await res.json()) as unknown;
  if (!Array.isArray(versions) || versions.some((v) => typeof v !== 'string')) {
    throw new Error('Data Dragon versions.json did not return a string array.');
  }
  return versions as string[];
}

export interface PatchRefreshResult {
  added: number;
  total: number;
}

/**
 * Refreshes `patches` from Data Dragon `versions.json`. Existing labels keep
 * their `patch_index` (append-only, never renumbered); labels missing from the
 * table are appended in source order after the current maximum.
 */
export async function refreshPatches(
  db: Database.Database,
  options: { fetchFn?: typeof fetch } = {},
): Promise<PatchRefreshResult> {
  const versions = await fetchPatchVersions(options.fetchFn);
  const labels = parsePatchLabels(versions);

  const existing = new Set(
    (db.prepare('SELECT version_label FROM patches').all() as Array<{ version_label: string }>).map(
      (row) => row.version_label,
    ),
  );
  const missing = labels.filter((label) => !existing.has(label));

  if (missing.length > 0) {
    const next = (
      db.prepare('SELECT COALESCE(MAX(patch_index), 0) + 1 AS n FROM patches').get() as {
        n: number;
      }
    ).n;
    const insert = db.prepare('INSERT INTO patches (patch_index, version_label) VALUES (?, ?)');
    const write = db.transaction(() => {
      missing.forEach((label, offset) => {
        insert.run(next + offset, label);
      });
    });
    write.immediate();
  }

  const total = (db.prepare('SELECT COUNT(*) AS n FROM patches').get() as { n: number }).n;
  return { added: missing.length, total };
}

/** Prepared lookup `version_label -> patch_index` (undefined when unknown). */
export function createPatchIndexLookup(
  db: Database.Database,
): (versionLabel: string) => number | undefined {
  const stmt = db.prepare('SELECT patch_index FROM patches WHERE version_label = ?');
  return (versionLabel) => {
    const row = stmt.get(versionLabel) as { patch_index: number } | undefined;
    return row?.patch_index;
  };
}

/** One-shot lookup `version_label -> patch_index` (undefined when unknown). */
export function lookupPatchIndex(db: Database.Database, versionLabel: string): number | undefined {
  const row = db
    .prepare('SELECT patch_index FROM patches WHERE version_label = ?')
    .get(versionLabel) as { patch_index: number } | undefined;
  return row?.patch_index;
}

export interface EnsurePatchesResult {
  /** 'current' = every label already known; 'refreshed' = new rows added; 'failed' = refresh errored. */
  status: 'current' | 'refreshed' | 'failed';
  added: number;
  total: number;
  error?: string;
}

/**
 * Ensures `patches` covers every stored `matches.patch` label (plus optional
 * extra labels). Refreshes from Data Dragon only when something is missing;
 * a refresh failure is reported via `onWarn` and returned as 'failed' so
 * callers can decide whether to continue with stale data.
 */
export async function ensurePatchesFresh(
  db: Database.Database,
  options: {
    fetchFn?: typeof fetch;
    extraLabels?: readonly string[];
    onWarn?: (message: string) => void;
  } = {},
): Promise<EnsurePatchesResult> {
  const lookup = createPatchIndexLookup(db);
  const stored = db.prepare('SELECT DISTINCT patch FROM matches').all() as Array<{
    patch: string;
  }>;
  const uncovered = new Set<string>();
  for (const row of stored) {
    if (lookup(row.patch) === undefined) uncovered.add(row.patch);
  }
  for (const label of options.extraLabels ?? []) {
    if (lookup(label) === undefined) uncovered.add(label);
  }
  if (uncovered.size === 0) {
    const total = (db.prepare('SELECT COUNT(*) AS n FROM patches').get() as { n: number }).n;
    return { status: 'current', added: 0, total };
  }

  try {
    const result = await refreshPatches(db, { fetchFn: options.fetchFn });
    return { status: 'refreshed', added: result.added, total: result.total };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onWarn?.(`could not refresh patches from Data Dragon: ${message}`);
    const total = (db.prepare('SELECT COUNT(*) AS n FROM patches').get() as { n: number }).n;
    return { status: 'failed', added: 0, total, error: message };
  }
}

export interface PatchResolver {
  /**
   * `version_label -> patch_index`. On a miss the patch list is refreshed from
   * Data Dragon once per resolver, then the lookup is retried. Returns
   * `undefined` when the label is still unknown after a successful refresh.
   * Throws when the refresh itself fails (callers treat it as transient).
   */
  resolve(versionLabel: string): Promise<number | undefined>;
}

/**
 * Async label->index resolver for ingestion: refreshes `patches` lazily on the
 * first unknown label (SPECS §12: refresh first, `invalid` reject only when the
 * label is still absent). A failed refresh rejects every pending resolve with a
 * fetch-flavoured error so the caller can treat it as transient.
 */
export function createPatchResolver(
  db: Database.Database,
  options: {
    fetchFn?: typeof fetch;
    onRefresh?: (result: PatchRefreshResult) => void;
    onWarn?: (message: string) => void;
  } = {},
): PatchResolver {
  const lookup = createPatchIndexLookup(db);
  let refreshPromise: Promise<void> | null = null;

  const ensureFresh = (): Promise<void> => {
    refreshPromise ??= refreshPatches(db, { fetchFn: options.fetchFn })
      .then((result) => {
        options.onRefresh?.(result);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        options.onWarn?.(`could not refresh patches from Data Dragon: ${message}`);
        throw new Error(`Failed to fetch patch list from Data Dragon: ${message}`);
      });
    return refreshPromise;
  };

  return {
    async resolve(versionLabel: string): Promise<number | undefined> {
      const known = lookup(versionLabel);
      if (known !== undefined) return known;
      await ensureFresh();
      return lookup(versionLabel);
    },
  };
}
