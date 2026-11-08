/**
 * @draftorb/etl — Minimal tar.gz extraction for `pnpm etl pull` (T-108, D-079).
 *
 * The state release's `public-exports.tar.gz` is produced by
 * `tar -czf -C data public`, so entries look like `public/<patch>/...`.
 * Extraction is deliberately strict:
 *   - only regular files and directories are written (links/devices rejected),
 *     directory after the `public/` prefix is stripped — entries that would
 *     escape it (`..`, absolute paths, drive letters, backslash traversal,
 *     NUL bytes) abort the whole extraction,
 *   - entries outside the expected prefix are skipped (e.g. pax headers).
 *
 * Uses `node:zlib` for gzip — no external `tar`/`gzip` binary required, so it
 * works identically on Windows, macOS and Linux.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK_SIZE = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;
const SIZE_FIELD = 124;
const TYPE_FLAG_OFFSET = 156;
const PREFIX_OFFSET = 345;

export interface TarEntryInfo {
  /** Normalized entry name (ustar prefix applied, leading './' stripped). */
  readonly name: string;
  /** '0'/'\0' regular file, '5' directory, 'L' GNU longname, other = metadata. */
  readonly type: string;
  readonly size: number;
  readonly data: Buffer;
}

function readOctal(field: Buffer): number {
  // Base-256 encoding (first byte & 0x80) for sizes beyond octal range.
  if ((field[0] ?? 0) & 0x80) {
    let value = field[0]! & 0x7f;
    for (let i = 1; i < field.length; i += 1) {
      value = value * 256 + (field[i] ?? 0);
    }
    return value;
  }
  const text = field.toString('utf8').replace(/\0.*$/s, '').trim();
  if (text === '') return 0;
  const value = Number.parseInt(text, 8);
  if (Number.isNaN(value) || value < 0) {
    throw new Error('Invalid tar header size field');
  }
  return value;
}

function entryName(header: Buffer): string {
  const name = header.subarray(0, NAME_MAX).toString('utf8').replace(/\0.*$/s, '');
  const magic = header.subarray(257, 263).toString('utf8');
  if (magic.startsWith('ustar')) {
    const prefix = header
      .subarray(PREFIX_OFFSET, PREFIX_OFFSET + PREFIX_MAX)
      .toString('utf8')
      .replace(/\0.*$/s, '');
    if (prefix !== '') return `${prefix}/${name}`;
  }
  return name;
}

/**
 * Parses a tar archive into entries. Throws on a truncated or malformed
 * archive. `data` holds the entry payload for regular files (and 'L'
 * longname records); directories and metadata carry an empty buffer.
 */
export function parseTar(archive: Buffer): TarEntryInfo[] {
  const entries: TarEntryInfo[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) break; // end-of-archive marker

    const size = readOctal(header.subarray(SIZE_FIELD, SIZE_FIELD + 12));
    const type = String.fromCharCode(header[TYPE_FLAG_OFFSET] ?? 0);
    let name = entryName(header);
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) {
      throw new Error(`Truncated tar archive: entry "${name}" exceeds archive size`);
    }
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (type === 'L') {
      // GNU longname: the payload is the real name of the NEXT entry.
      pendingLongName = data.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (pendingLongName !== null) {
      name = pendingLongName;
      pendingLongName = null;
    }
    entries.push({ name: name.replace(/^\.\//, ''), type, size, data });
  }

  return entries;
}

/**
 * Resolves an archive entry name to a path inside `targetDir`, or returns
 * null when the entry is outside the `stripPrefix` (skipped, e.g. pax global
 * headers). Throws when the entry would escape `targetDir`.
 */
export function resolveEntryTarget(
  targetDir: string,
  stripPrefix: string,
  rawName: string,
): string | null {
  const normalized = rawName.replace(/^\.\//, '');
  if (normalized === '') return null;
  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    throw new Error(`Unsafe tar entry name (absolute path): "${rawName}"`);
  }
  if (normalized.includes('\0')) {
    throw new Error(`Unsafe tar entry name (NUL byte): "${rawName}"`);
  }
  if (normalized.includes('\\')) {
    // Backslashes are not path separators inside tar names; on Windows they
    // would be. Entries that merely contain one are skipped, but anything
    // that looks like traversal through them is rejected outright.
    const backslashSegments = normalized.split('\\');
    if (backslashSegments.some((segment) => segment === '' || segment === '..')) {
      throw new Error(`Unsafe tar entry name (backslash traversal): "${rawName}"`);
    }
    return null;
  }

  const prefix = `${stripPrefix}/`;
  if (!normalized.startsWith(prefix)) return null;
  const inner = normalized.slice(prefix.length);
  if (inner === '') return null; // the prefix directory itself

  const segments = inner.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Unsafe tar entry name: "${rawName}"`);
    }
    if (/^[A-Za-z]:/.test(segment)) {
      throw new Error(`Unsafe tar entry name (drive letter): "${rawName}"`);
    }
  }

  const root = resolve(targetDir);
  const target = resolve(join(root, ...segments));
  const escape = relative(root, target);
  if (escape === '..' || escape.startsWith(`..${sep}`) || isAbsolute(escape)) {
    throw new Error(`Tar entry escapes the target directory: "${rawName}"`);
  }
  return target;
}

export interface ExtractedFile {
  /** Path relative to the target directory (posix separators). */
  readonly path: string;
}

/**
 * Extracts a gzipped tar archive into `targetDir`. Entries must live under
 * `stripPrefix` (e.g. `public`); only files and directories are written.
 * Returns the written file paths relative to `targetDir`.
 */
export function extractTarGz(
  archiveGz: Buffer,
  targetDir: string,
  options: { stripPrefix?: string } = {},
): ExtractedFile[] {
  const stripPrefix = options.stripPrefix ?? 'public';
  const entries = parseTar(gunzipSync(archiveGz));
  const written: ExtractedFile[] = [];

  for (const entry of entries) {
    const target = resolveEntryTarget(targetDir, stripPrefix, entry.name);
    if (target === null) continue;

    if (entry.type === '5') {
      mkdirSync(target, { recursive: true });
      continue;
    }
    if (entry.type !== '0' && entry.type !== '\0') {
      // Links, devices, pax metadata, ...: never written to disk.
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
    written.push({ path: entry.name.slice(stripPrefix.length + 1) });
  }

  return written;
}
