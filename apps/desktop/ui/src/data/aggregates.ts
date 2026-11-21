/**
 * Public aggregates download-at-launch (BL-010b, D-111, SPECS §20).
 *
 * Fetches `aggregates.tar.gz` from the public `data-latest` release, gunzips
 * it (DecompressionStream), parses the ustar entries our ETL writer produces,
 * verifies every file against the manifest sha256, then caches each file via
 * the `data_cache_*` Tauri commands. Offline fallback: the cached
 * `latest.json` still loads and the UI shows a stale-data notice.
 *
 * In a plain browser (vite dev, no shell) the same flow runs against an
 * in-memory map so the module stays testable and dev-friendly.
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invokeCommand, isTauri } from '../tauri';
import { PUBLIC_DATA_URL } from '../config';

export interface CacheMeta {
  patch: string;
  generatedAt: string;
  downloadedAt: string;
}

export type DataLoad =
  | { kind: 'none' }
  | { kind: 'loaded'; patch: string; generatedAt: string; stale: boolean };

const META_NAME = 'cache-meta.json';
const FETCH_TIMEOUT_MS = 15_000;

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

async function cacheWrite(name: string, content: string): Promise<void> {
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

export async function readCachedMeta(): Promise<CacheMeta | null> {
  const raw = await cacheRead(META_NAME);
  if (raw === null) return null;
  try {
    const meta = JSON.parse(raw) as CacheMeta;
    return typeof meta.patch === 'string' ? meta : null;
  } catch {
    return null;
  }
}

// ---------- download ----------

interface ManifestFile {
  path: string;
  sha256?: string;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  // GitHub release assets do not send CORS headers, so inside the Tauri
  // webview the request must go through the http plugin (Rust-side fetch).
  if (isTauri()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        tauriFetch(url) as Promise<Response>,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('download timed out')), FETCH_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
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
  const manifestEntry = [...byName.keys()].find((n) => n.endsWith('/manifest.json'));
  if (latestEntry === undefined || manifestEntry === undefined) {
    throw new Error('archive is missing latest.json or a manifest');
  }
  const manifestBytes = byName.get(manifestEntry);
  if (manifestBytes === undefined) throw new Error('archive is missing the manifest');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    files?: ManifestFile[];
  };
  const manifestDir = manifestEntry.slice(0, manifestEntry.lastIndexOf('/'));

  // Verify every manifest-listed file against its sha256 before caching.
  for (const file of manifest.files ?? []) {
    const entry = byName.get(`${manifestDir}/${file.path}`);
    if (entry === undefined) throw new Error(`archive missing ${file.path}`);
    if (file.sha256 !== undefined && (await sha256Hex(entry)) !== file.sha256) {
      throw new Error(`sha256 mismatch for ${file.path}`);
    }
  }

  const decoder = new TextDecoder();
  for (const entry of tar) {
    await cacheWrite(entry.name, decoder.decode(entry.data));
  }
  const latest = JSON.parse(decoder.decode(latestEntry)) as { patch?: string; generatedAt?: string };
  if (typeof latest.patch !== 'string') throw new Error('latest.json has no patch');
  const meta: CacheMeta = {
    patch: latest.patch,
    generatedAt: typeof latest.generatedAt === 'string' ? latest.generatedAt : '',
    downloadedAt: new Date().toISOString(),
  };
  await cacheWrite(META_NAME, JSON.stringify(meta));
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
      const meta = await readCachedMeta();
      if (meta !== null) {
        return { kind: 'loaded', patch: meta.patch, generatedAt: meta.generatedAt, stale: true };
      }
    } catch {
      // Cache unreadable: report no data rather than reject the launch flow.
    }
    return { kind: 'none' };
  }
}

/** Reads one cached aggregate file (`latest.json`, `<patch>/x.json`). */
export async function readDataFile(name: string): Promise<string | null> {
  return cacheRead(name);
}

/** Drops every cached aggregate file (Tauri `data_cache_clear` or memory). */
export async function clearDataCache(): Promise<void> {
  memoryCache.clear();
  if (isTauri()) {
    await invokeCommand('data_cache_clear');
  }
}
