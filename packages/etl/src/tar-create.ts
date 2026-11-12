/**
 * @draftorb/etl — Minimal tar.gz writer for `pnpm etl publish` (D-091, T-128).
 *
 * Companion to `tar-extract.ts`: produces a ustar archive that
 * `extractTarGz`/`parseTar` read back identically. Entries are regular
 * files only (directories are implied by paths — the extractor mkdirs them).
 * Pure Node (`node:zlib`), no external tar/gzip binary, Windows-safe.
 */

import { gzipSync } from 'node:zlib';

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;

export interface TarFileEntry {
  /** Archive path, posix separators, e.g. `public/16.22/baseline.json`. */
  readonly name: string;
  readonly data: Buffer;
}

function octal(value: number, length: number): Buffer {
  const text = value.toString(8).padStart(length - 1, '0');
  const field = Buffer.alloc(length);
  field.write(text.slice(-length + 1), 0, 'ascii');
  field[length - 1] = 0;
  return field;
}

function writeString(field: Buffer, value: string): void {
  field.write(value, 0, 'utf8');
}

function header(name: string, size: number): Buffer {
  if (name.includes('\0') || name.startsWith('/') || name.includes('..')) {
    throw new Error(`Unsafe tar entry name: "${name}"`);
  }
  const headerBuf = Buffer.alloc(BLOCK);
  let nameField = name;
  let prefixField = '';
  if (Buffer.byteLength(name) > NAME_MAX) {
    // ustar split: prefix (<=155) + '/' + name (<=100).
    // First '/' at or after the point where the suffix fits NAME_MAX.
    const idx = name.indexOf('/', name.length - NAME_MAX - 1);
    if (idx <= 0 || idx > PREFIX_MAX || name.length - idx - 1 > NAME_MAX) {
      throw new Error(`Tar entry name too long for ustar: "${name}"`);
    }
    prefixField = name.slice(0, idx);
    nameField = name.slice(idx + 1);
    if (Buffer.byteLength(nameField) > NAME_MAX || Buffer.byteLength(prefixField) > PREFIX_MAX) {
      throw new Error(`Tar entry name too long for ustar: "${name}"`);
    }
  }
  writeString(headerBuf.subarray(0, NAME_MAX), nameField);
  octal(0o644, 8).copy(headerBuf, 100); // mode
  octal(0, 8).copy(headerBuf, 108); // uid
  octal(0, 8).copy(headerBuf, 116); // gid
  octal(size, 12).copy(headerBuf, 124);
  octal(0, 12).copy(headerBuf, 136); // mtime
  headerBuf.fill(0x20, 148, 156); // chksum placeholder = spaces
  headerBuf[156] = 0x30; // typeflag '0' regular file
  writeString(headerBuf.subarray(257, 263), 'ustar\0');
  writeString(headerBuf.subarray(263, 265), '00');
  if (prefixField !== '') writeString(headerBuf.subarray(345, 500), prefixField);
  // checksum: sum of all header bytes with chksum field as spaces
  let sum = 0;
  for (const byte of headerBuf) sum += byte;
  const chksum = sum.toString(8).padStart(6, '0') + '\0 ';
  headerBuf.write(chksum, 148, 8, 'ascii');
  return headerBuf;
}

/**
 * Builds a gzipped tar archive from regular-file entries. Throws on unsafe
 * or oversized names. Deterministic: entries are emitted in the given order.
 */
export function createTarGz(entries: readonly TarFileEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(header(entry.name, entry.data.length), entry.data);
    const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
    if (pad > 0) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(BLOCK * 2)); // end-of-archive marker
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}
