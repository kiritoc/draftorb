/**
 * Public aggregates download-at-launch (BL-010b, D-111, SPECS §20).
 *
 * Fetches `aggregates.tar.gz` from the public `data-latest` release, gunzips
 * it (DecompressionStream), parses the ustar entries our ETL writer produces,
 * verifies every file against the manifest sha256 (fail-closed: a missing
 * hash or an uncovered entry rejects the archive), then caches each file via
 * the `data_cache_*` Tauri commands. Offline fallback: the cached
 * `latest.json` still loads and the UI shows a stale-data notice.
 *
 * In a plain browser (vite dev, no shell) the same flow runs against an
 * in-memory map so the module stays testable and dev-friendly.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { z } from 'zod';

import { latestSchema, manifestSchema, type Manifest } from '@draftorb/shared';

import { invokeCommand, isTauri } from '../tauri';
import { PUBLIC_DATA_URL } from '../config';

const cacheMetaSchema = z.object({
  schemaVersion: z.literal(1),
  patch: z.string().min(1),
  generatedAt: z.string().min(1),
  downloadedAt: z.string().min(1),
});
export type CacheMeta = z.infer<typeof cacheMetaSchema>;

export type DataLoad =
  | { kind: 'none' }
  | { kind: 'loaded'; patch: string; generatedAt: string; stale?: boolean };

const META_NAME = 'cache-meta.json';
const FETCH_TIMEOUT_MS = 15_000;
/** Archive-root files written last so a mid-download crash leaves either the
 * old consistent cache or a detectable latest/meta mismatch. */
const ROOT_FILES = new Set(['latest.json', 'champion-tags.json']);
/** Top-level cache entries kept across patch upgrades. */
const CACHE_KEEP = new Set([META_NAME, ...ROOT_FILES]);

// ---------- tar.gz parsing (ustar, entries our createTarGz writes) ----------

interface TarEntry {
  name: string;
  data: Uint8Array;
}

function parseOctal(buf: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let i = offset; i < offset + length; i += 1) {
    const c = buf[i] ?? 0;
    if (c === 0 || c === 32) break;
    if (c < 48 || c > 55) throw new Error('bad tar size field');
    value = value * 8 + (c - 48);
  }
  return value;
}

function parseTar(buf: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const nameBytes = header.subarray(0, 100);
    const nameEnd = nameBytes.indexOf(0);
    let name = new TextDecoder().decode(nameBytes.subarray(0, nameEnd === -1 ? 100 : nameEnd));
    const size = parseOctal(header, 124, 12);
    const prefixBytes = header.subarray(345, 500);
    const prefixEnd = prefixBytes.indexOf(0);
    if (prefixEnd > 0) {
      name = `${new TextDecoder().decode(prefixBytes.subarray(0, prefixEnd))}/${name}`;
    }
    offset += 512;
    if (name !== '' && !name.endsWith('/')) {
      entries.push({ name, data: buf.slice(offset, offset + size) });
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- sha256 ----------

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- cache backend ----------

const memoryCache = new Map<string, string>();

/** Writes one cache entry (exported for tests seeding partial states). */
export async function cacheWrite(name: string, content: string): Promise<void> {
  if (isTauri()) {
    await invokeCommand('data_cache_write', { name, content });
  } else {
    memoryCache.set(name, content);
  }
}

export async function cacheRead(name: string): Promise<string | null> {
  if (isTauri()) {
    return invokeCommand<string | null>('data_cache_read', { name });
  }
  return memoryCache.get(name) ?? null;
}

/** Drops cached top-level entries outside `keep` (old patch dirs, stray tmp). */
async function cachePrune(keepPatch: string): Promise<void> {
  const keep = new Set([...CACHE_KEEP, keepPatch]);
  if (isTauri()) {
    await invokeCommand('data_cache_prune', { keep: [...keep] });
    return;
  }
  for (const key of [...memoryCache.keys()]) {
    const top = key.split('/')[0] ?? key;
    if (!keep.has(top)) memoryCache.delete(key);
  }
}

export async function readCachedMeta(): Promise<CacheMeta | null> {
  const raw = await cacheRead(META_NAME);
  if (raw === null) return null;
  try {
    const parsed = cacheMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Cached meta is only trusted when the cached `latest.json` agrees on the
 * patch — a crash between the two writes must not serve a mixed cache. */
async function readConsistentMeta(): Promise<CacheMeta | null> {
  const meta = await readCachedMeta();
  if (meta === null) return null;
  const raw = await cacheRead('latest.json');
  if (raw === null) return null;
  try {
    const latest = latestSchema.safeParse(JSON.parse(raw));
    if (!latest.success || latest.data.patch !== meta.patch) return null;
  } catch {
    return null;
  }
  return meta;
}

// ---------- download ----------

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('download timed out')), FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  // GitHub release assets do not send CORS headers, so inside the Tauri
  // webview the request must go through the http plugin (Rust-side fetch,
  // which the webview cannot abort — the timeout is a race there).
  if (isTauri()) {
    return withTimeout(tauriFetch(url) as Promise<Response>);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies the archive against the manifest, fail-closed: every manifest
 * entry must carry a sha256, every listed file must exist and match, and no
 * tar entry may go unlisted (the manifest itself is the trust root).
 * Manifest paths are patch-relative (`champions.json`) or archive-root
 * absolute (`/latest.json`, added by `publish-public`).
 */
async function verifyArchive(
  byName: Map<string, Uint8Array>,
  manifestName: string,
  manifest: Manifest,
): Promise<void> {
  const manifestDir = manifestName.includes('/')
    ? manifestName.slice(0, manifestName.lastIndexOf('/'))
    : '';
  const covered = new Set<string>([manifestName]);
  for (const file of manifest.files) {
    const archivePath = file.path.startsWith('/')
      ? file.path.slice(1)
      : manifestDir === ''
        ? file.path
        : `${manifestDir}/${file.path}`;
    const entry = byName.get(archivePath);
    if (entry === undefined) throw new Error(`archive missing ${archivePath}`);
    if (file.sha256 === undefined) {
      throw new Error(`manifest entry ${file.path} has no sha256`);
    }
    if ((await sha256Hex(entry)) !== file.sha256) {
      throw new Error(`sha256 mismatch for ${archivePath}`);
    }
    covered.add(archivePath);
  }
  for (const name of byName.keys()) {
    if (!covered.has(name)) {
      throw new Error(`archive file not covered by the manifest: ${name}`);
    }
  }
}

/** Downloads, verifies and caches the aggregates. Throws on any failure. */
export async function downloadAggregates(url = PUBLIC_DATA_URL): Promise<CacheMeta> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const tar = parseTar(await gunzip(await response.arrayBuffer()));
  if (tar.length === 0) throw new Error('empty aggregates archive');

  const byName = new Map(tar.map((e) => [e.name, e.data]));
  const latestEntry = byName.get('latest.json');
  if (latestEntry === undefined) throw new Error('archive is missing latest.json');
  const latest = latestSchema.safeParse(JSON.parse(new TextDecoder().decode(latestEntry)));
  if (!latest.success) throw new Error('latest.json is invalid');

  const manifestName = latest.data.manifest;
  const manifestEntry = byName.get(manifestName);
  if (manifestEntry === undefined) {
    throw new Error(`archive is missing ${manifestName}`);
  }
  const manifest = manifestSchema.safeParse(
    JSON.parse(new TextDecoder().decode(manifestEntry)),
  );
  if (!manifest.success || manifest.data.patch !== latest.data.patch) {
    throw new Error(`invalid manifest ${manifestName}`);
  }
  await verifyArchive(byName, manifestName, manifest.data);

  const decoder = new TextDecoder();
  const ordered = [...tar].sort(
    (a, b) => Number(ROOT_FILES.has(a.name)) - Number(ROOT_FILES.has(b.name)),
  );
  for (const entry of ordered) {
    await cacheWrite(entry.name, decoder.decode(entry.data));
  }
  const meta: CacheMeta = {
    schemaVersion: 1,
    patch: latest.data.patch,
    generatedAt: latest.data.generatedAt,
    downloadedAt: new Date().toISOString(),
  };
  await cacheWrite(META_NAME, JSON.stringify(meta));
  // Best-effort: stale patch dirs are dropped after the consistent state is
  // already durable; a prune failure must not fail the download.
  await cachePrune(latest.data.patch).catch(() => {});
  return meta;
}

/**
 * Launch flow: try the network first; on any failure fall back to the cache.
 * `stale` is true when the cached copy is served because the download failed.
 */
export async function ensureData(url = PUBLIC_DATA_URL): Promise<DataLoad> {
  try {
    const meta = await downloadAggregates(url);
    return { kind: 'loaded', patch: meta.patch, generatedAt: meta.generatedAt, stale: false };
  } catch {
    try {
      const meta = await readConsistentMeta();
      if (meta !== null) {
        return { kind: 'loaded', patch: meta.patch, generatedAt: meta.generatedAt, stale: true };
      }
    } catch {
      // Cache unreadable: report no data rather than reject the launch flow.
    }
    return { kind: 'none' };
  }
}

/** Drops every cached aggregate file (Tauri `data_cache_clear` or memory). */
export async function clearDataCache(): Promise<void> {
  memoryCache.clear();
  if (isTauri()) {
    await invokeCommand('data_cache_clear');
  }
}
