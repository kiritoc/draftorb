#!/usr/bin/env node
/**
 * Generates src-tauri/icons/icon.ico for the BL-002 spike.
 * Writes a 256x256 solid-color PNG wrapped in an ICO container
 * (PNG-in-ICO is valid since Windows Vista).
 *
 * Usage: pnpm --filter @draftorb/desktop gen:icon
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const outPath = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons', 'icon.ico'),
);

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Solid dark-blue square with a lighter inner square (simple "orb" mark).
const px = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  px[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const i = row + 1 + x * 4;
    const inner = x >= 64 && x < 192 && y >= 64 && y < 192;
    px[i] = inner ? 0x7c : 0x1d; // R
    px[i + 1] = inner ? 0xc8 : 0x4e; // G
    px[i + 2] = inner ? 0xff : 0xa5; // B
    px[i + 3] = 0xff; // A
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
// compression/filter/interlace bytes stay 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(px, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ICO: ICONDIR (reserved, type=1, count=1) + ICONDIRENTRY + PNG payload.
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count
const entry = Buffer.alloc(16);
entry[0] = 0; // width  (0 = 256)
entry[1] = 0; // height (0 = 256)
entry[2] = 0; // palette
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8); // data size
entry.writeUInt32LE(22, 12); // data offset (6 + 16)

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.concat([header, entry, png]));
console.log(`wrote ${outPath} (${png.length} bytes PNG in ICO)`);
