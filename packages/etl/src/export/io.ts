/**
 * @draftorb/etl — JSON export: low-level IO, hashing, size checks, and shared
 * export helpers (rounding, n_eff gate).
 *
 * IO is isolated here: every other export module produces plain { relativePath,
 * content } descriptors and never touches the filesystem or `node:` APIs
 * directly.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { nEff } from '@draftorb/engine';

/** Size budget per exported file (gzip), DATA_MODEL.md §Exported JSON. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A row survives export only when its equivalent sample size clears the gate. */
export function passesGate(gamesW: number, gamesW2: number, exportMinGames: number): boolean {
  return nEff(gamesW, gamesW2) >= exportMinGames;
}

export interface ExportFile {
  path: string;
  relativePath: string;
  bytes: number;
  sha256: string;
}

/** Writes `content` to `dir/relativePath` (exact UTF-8 bytes) and returns the
 *  path, byte length, and sha256 of the bytes that were written. */
export function writeFile(dir: string, relativePath: string, content: string): ExportFile {
  const fullPath = join(dir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  return { path: fullPath, relativePath, bytes, sha256 };
}

/** Gzip size of `content` in bytes (DATA_MODEL.md calls the budget "gzip"). */
export function gzipSize(content: string): number {
  return gzipSync(content).length;
}

/** Returns a warning message when `content` gzip-exceeds `maxBytes`, else null. */
export function oversizeWarning(
  relativePath: string,
  content: string,
  maxBytes: number,
): string | null {
  const size = gzipSize(content);
  if (size > maxBytes) {
    return `[ETL] export: ${relativePath} gzip size ${size} bytes is above the ${maxBytes} byte budget; consider raising exportMinGames for this file.`;
  }
  return null;
}

export function createTempDir(publicDir: string, patch: string): string {
  const tempDir = join(publicDir, `.${patch}.tmp-${process.pid}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

export function publishTempDir(tempDir: string, targetDir: string): void {
  rmSync(targetDir, { recursive: true, force: true });
  renameSync(tempDir, targetDir);
}

export function removeTempDir(tempDir: string): void {
  rmSync(tempDir, { recursive: true, force: true });
}
