/**
 * @draftorb/etl — Patch index table (D-043, SPECS §12; ordering and refresh
 * rules finalized by D-055).
 *
 * `patches` maps every released `major.minor` label to a stable ordinal
 * `patch_index`. Labels are ordered NUMERICALLY by (major, minor) — never by
 * string compare (`14.10` > `14.9`) and never by raw source position — and
 * indices are gap-free starting at 1. `versions.json` is the ordering source;
 * hotfixes sharing a `major.minor` label collapse to one row.
 *
 * Stability guarantee: `refreshPatches` is append-only. Data Dragon only ever
 * prepends newer versions, so every newly seen label sorts after the newest
 * stored one and is appended at `max(patch_index) + 1`. Before inserting, the
 * stored table is verified to be gap-free and numerically ordered, and every
 * missing label must sort strictly after the newest stored label; otherwise
 * the refresh fails loudly instead of renumbering or misordering.
 */

import type Database from 'better-sqlite3';

const DDRAGON_VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';

/** `major.minor` label, identical to `matches.patch` (RIOT_API.md). */
export const PATCH_LABEL_PATTERN = /^\d+\.\d+$/;

interface PatchVersionParts {
  label: string;
  major: number;
  minor: number;
}

/**
 * Parses a Data Dragon / game version into its `major.minor` label plus the
 * numeric (major, minor) pair used for ordering. Returns `null` for entries
 * that are not `major.minor[.patch]` versions (e.g. the legacy
 * `lolpatch_7.20` entries in versions.json, D-043 note).
 */
function parsePatchVersionParts(version: string): PatchVersionParts | null {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version.trim());
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return { label: `${match[1]}.${match[2]}`, major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Parses a Data Dragon / game version into its `major.minor` label.
 * Returns `null` for entries that are not `major.minor[.patch]` versions.
 */
export function parsePatchLabel(version: string): string | null {
  return parsePatchVersionParts(version)?.label ?? null;
}

/**
 * Numeric `major.minor` compare (`14.9` < `14.10`). Unparseable labels fall
 * back to string compare so callers never get NaN.
 */
export function comparePatchLabels(a: string, b: string): number {
  const pa = parsePatchVersionParts(a);
  const pb = parsePatchVersionParts(b);
  if (pa === null || pb === null) return a < b ? -1 : a > b ? 1 : 0;
  return pa.major - pb.major || pa.minor - pb.minor;
}

/**
 * Ordered `major.minor` labels from a `versions.json` payload: deduplicated
 * (hotfixes collapse to one label) and sorted by NUMERIC (major, minor)
 * order — input order does not matter. Unparseable entries are skipped with
 * a single `onWarn` summary.
 */
export function parsePatchLabels(
  versions: readonly string[],
  options: { onWarn?: (message: string) => void } = {},
): string[] {
  const byLabel = new Map<string, { major: number; minor: number }>();
  const skipped: string[] = [];
  for (const version of versions) {
    const parts = parsePatchVersionParts(version);
    if (parts === null) {
      skipped.push(version);
      continue;
    }
    byLabel.set(parts.label, { major: parts.major, minor: parts.minor });
  }
  if (skipped.length > 0) {
    const shown = skipped.slice(0, 5).join(', ');
    const suffix = skipped.length > 5 ? ` (+${skipped.length - 5} more)` : '';
    options.onWarn?.(
      `skipped ${skipped.length} unparseable versions.json entr${skipped.length === 1 ? 'y' : 'ies'}: ${shown}${suffix}`,
    );
  }
  return [...byLabel.entries()]
    .sort((a, b) => a[1].major - b[1].major || a[1].minor - b[1].minor)
    .map(([label]) => label);
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

interface StoredPatchRow {
  patch_index: number;
  version_label: string;
}

/**
 * Verifies the stored catalog is gap-free (`patch_index` = 1..n contiguous)
 * and numerically ordered (index order == (major, minor) order). Both
 * invariants are what make append-only refresh stable; a hand-edited or
 * legacy table fails loudly here instead of producing wrong recency weights.
 */
function assertPatchCatalogConsistency(rows: readonly StoredPatchRow[]): void {
  for (const [i, row] of rows.entries()) {
    if (row.patch_index !== i + 1) {
      throw new Error(
        `Refusing to refresh patches: the patches table is not gap-free ` +
          `(patch_index ${row.patch_index} at sorted position ${i + 1}). Rebuild the table.`,
      );
    }
    const previous = rows[i - 1];
    if (
      previous !== undefined &&
      comparePatchLabels(previous.version_label, row.version_label) >= 0
    ) {
      throw new Error(
        `Refusing to refresh patches: stored order is not numeric ` +
          `("${previous.version_label}" index ${previous.patch_index} vs ` +
          `"${row.version_label}" index ${row.patch_index}). Rebuild the table.`,
      );
    }
  }
}

/**
 * Refreshes `patches` from Data Dragon `versions.json`. Existing labels keep
 * their `patch_index` (append-only, never renumbered); labels missing from
 * the table are appended in numeric order after the current maximum — valid
 * only because versions.json grows at the top, so every new label is newer
 * than every stored one. Throws when the stored table is inconsistent or a
 * missing label would have to be inserted before existing rows.
 */
export async function refreshPatches(
  db: Database.Database,
  options: { fetchFn?: typeof fetch; onWarn?: (message: string) => void } = {},
): Promise<PatchRefreshResult> {
  const versions = await fetchPatchVersions(options.fetchFn);
  const labels = parsePatchLabels(versions, { onWarn: options.onWarn });

  const rows = db
    .prepare('SELECT patch_index, version_label FROM patches ORDER BY patch_index')
    .all() as StoredPatchRow[];
  const existing = new Set(rows.map((row) => row.version_label));
  const missing = labels.filter((label) => !existing.has(label));

  if (missing.length === 0) {
    return { added: 0, total: rows.length };
  }

  const newest = rows[rows.length - 1];
  if (newest !== undefined) {
    assertPatchCatalogConsistency(rows);
    const notNewer = missing.filter(
      (label) => comparePatchLabels(label, newest.version_label) <= 0,
    );
    if (notNewer.length > 0) {
      throw new Error(
        `Refusing to refresh patches: ${notNewer.length} versions.json label(s) do not sort ` +
          `after the newest stored patch "${newest.version_label}" ` +
          `(${notNewer.slice(0, 5).join(', ')}). Appending them would break the stable ` +
          'numeric patch_index ordering; rebuild the patches table instead.',
      );
    }
  }

  const next = (newest?.patch_index ?? 0) + 1;
  const insert = db.prepare('INSERT INTO patches (patch_index, version_label) VALUES (?, ?)');
  const write = db.transaction(() => {
    missing.forEach((label, offset) => {
      insert.run(next + offset, label);
    });
  });
  write.immediate();

  return { added: missing.length, total: rows.length + missing.length };
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

/** Highest stored `patch_index` (`null` when the `patches` table is empty). */
export function latestPatchIndex(db: Database.Database): number | null {
  const row = db.prepare('SELECT MAX(patch_index) AS n FROM patches').get() as
    { n: number | null } | undefined;
  return row?.n ?? null;
}

export interface EnsurePatchCoverageResult {
  /** 'current' = every needed label already known; 'refreshed' = new rows added; 'failed' = refresh errored. */
  status: 'current' | 'refreshed' | 'failed';
  added: number;
  total: number;
  error?: string;
  /** Needed labels (stored matches + extras) still absent from `patches`. */
  unresolvedLabels: string[];
  /** Distinct stored `matches.patch` labels absent from `patches` (orphans). */
  orphanLabels: string[];
  /** Number of stored matches whose patch label is orphaned. */
  orphanMatches: number;
}

/**
 * Ensures `patches` covers every stored `matches.patch` label (plus optional
 * extra labels such as an explicit snapshot patch). Fetches `versions.json`
 * at most once per call and only when something is missing; a refresh
 * failure is reported via `onWarn` and returned as 'failed' so callers can
 * proceed with stale data. Labels still unresolved afterwards are reported
 * (`unresolvedLabels`); stored labels among them are orphans that aggregation
 * excludes — `orphanLabels`/`orphanMatches` make that exclusion visible
 * instead of silent (D-055).
 */
export async function ensurePatchCoverage(
  db: Database.Database,
  options: {
    fetchFn?: typeof fetch;
    extraLabels?: readonly string[];
    onWarn?: (message: string) => void;
  } = {},
): Promise<EnsurePatchCoverageResult> {
  const storedRows = db
    .prepare('SELECT patch, COUNT(*) AS n FROM matches GROUP BY patch')
    .all() as Array<{ patch: string; n: number }>;
  const storedLabels = storedRows.map((row) => row.patch);

  const compute = () => {
    const lookup = createPatchIndexLookup(db);
    const needed = new Set([...storedLabels, ...(options.extraLabels ?? [])]);
    const unresolvedLabels = [...needed].filter((label) => lookup(label) === undefined).sort();
    const unresolved = new Set(unresolvedLabels);
    const orphanRows = storedRows.filter((row) => unresolved.has(row.patch));
    return {
      unresolvedLabels,
      orphanLabels: orphanRows.map((row) => row.patch).sort(),
      orphanMatches: orphanRows.reduce((sum, row) => sum + row.n, 0),
    };
  };

  const before = compute();
  if (before.unresolvedLabels.length === 0) {
    const total = (db.prepare('SELECT COUNT(*) AS n FROM patches').get() as { n: number }).n;
    return { status: 'current', added: 0, total, ...before };
  }

  try {
    const result = await refreshPatches(db, { fetchFn: options.fetchFn, onWarn: options.onWarn });
    return { status: 'refreshed', added: result.added, total: result.total, ...compute() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onWarn?.(`could not refresh patches from Data Dragon: ${message}`);
    const total = (db.prepare('SELECT COUNT(*) AS n FROM patches').get() as { n: number }).n;
    return { status: 'failed', added: 0, total, error: message, ...before };
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
  /**
   * Forces the shared one-per-run catalog refresh — the same fetch `resolve`
   * triggers on a miss. Used when the table is empty and the run needs the
   * catalog before any label lookup (e.g. the retention bound in `matches`).
   */
  refresh(): Promise<void>;
}

/**
 * Async label->index resolver for ingestion: refreshes `patches` lazily on the
 * first unknown label (SPECS §12: refresh first, `invalid` reject only when the
 * label is still absent). A failed refresh rejects every pending resolve with a
 * fetch-flavoured error so the caller can treat it as transient. At most one
 * `versions.json` fetch happens per resolver, shared by `resolve` and
 * `refresh`.
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
    refreshPromise ??= refreshPatches(db, { fetchFn: options.fetchFn, onWarn: options.onWarn })
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
    refresh: ensureFresh,
  };
}

/** `ingest_state` key holding the last aggregate-run patch metadata (D-055). */
export const AGGREGATE_SNAPSHOT_KEY = 'aggregate:snapshot';
