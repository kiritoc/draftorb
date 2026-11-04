/**
 * @draftorb/etl — JSON export: low-level IO, hashing, size checks, and shared
 * export helpers (rounding, n_eff gate).
 *
 * IO is isolated here: every other export module produces plain { relativePath,
 * content } descriptors and never touches the filesystem or `node:` APIs
 * directly.
 */

import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { nEff } from '@draftorb/engine';

/** Size budget per exported file (gzip), DATA_MODEL.md §Exported JSON. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const STALE_EXPORT_DIR_AGE_MS = 24 * 60 * 60 * 1000;

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

/** Atomically replaces `dir/relativePath`: writes a unique sibling temp file,
 *  then renames it over the target. On failure the previous file is untouched. */
export function writeFileAtomic(dir: string, relativePath: string, content: string): string {
  const fullPath = join(dir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const tempPath = join(dirname(fullPath), `.${basename(fullPath)}.tmp-${randomUUID()}`);
  try {
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, fullPath);
  } catch (error: unknown) {
    rmSync(tempPath, { force: true });
    throw error;
  }
  return fullPath;
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
  mkdirSync(publicDir, { recursive: true });
  return mkdtempSync(join(publicDir, `.${patch}.tmp-`));
}

/** Publishes `tempDir` as `targetDir`. Returns a warning when the new tree is
 *  live but the superseded backup could not be removed (left for stale cleanup). */
export function publishTempDir(
  tempDir: string,
  targetDir: string,
  removeBackup: (backupDir: string) => void = (backupDir) =>
    rmSync(backupDir, { recursive: true, force: true }),
): string | null {
  const parentDir = dirname(targetDir);
  const backupDir = join(parentDir, `.${basename(targetDir)}.old-${randomUUID()}`);
  const hadTarget = existsSync(targetDir);
  let backupExists = false;
  let published = false;
  let preserveBackup = false;
  let cleanupWarning: string | null = null;

  try {
    if (hadTarget) {
      renameSync(targetDir, backupDir);
      backupExists = true;
    }

    try {
      renameSync(tempDir, targetDir);
      published = true;
    } catch (publishError: unknown) {
      if (backupExists) {
        try {
          renameSync(backupDir, targetDir);
          backupExists = false;
        } catch (rollbackError: unknown) {
          preserveBackup = true;
          throw new AggregateError(
            [publishError, rollbackError],
            `Failed to publish ${targetDir} and restore its previous directory`,
          );
        }
      }
      throw publishError;
    }
  } finally {
    if (published && backupExists && !preserveBackup) {
      try {
        removeBackup(backupDir);
      } catch (cleanupError: unknown) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        cleanupWarning = `export: published ${targetDir} but could not remove backup ${backupDir} (${message}); it will be removed by stale cleanup`;
      }
    }
  }
  return cleanupWarning;
}

/** Static catalogs written by `pnpm etl static` into the same patch directory. */
export const STATIC_CATALOG_FILES = ['champions.json', 'items.json', 'runes.json'] as const;

/** Reads existing static catalogs from `patchDir` so they survive re-publish. */
export function readStaticCatalogs(
  patchDir: string,
): Array<{ relativePath: string; content: string }> {
  const found: Array<{ relativePath: string; content: string }> = [];
  for (const relativePath of STATIC_CATALOG_FILES) {
    const fullPath = join(patchDir, relativePath);
    if (existsSync(fullPath)) {
      found.push({ relativePath, content: readFileSync(fullPath, 'utf8') });
    }
  }
  return found;
}

export function removeTempDir(tempDir: string): void {
  rmSync(tempDir, { recursive: true, force: true });
}

export function cleanupStaleExportDirs(publicDir: string, patch: string): void {
  mkdirSync(publicDir, { recursive: true });
  const targetExists = existsSync(join(publicDir, patch));
  const staleBefore = Date.now() - STALE_EXPORT_DIR_AGE_MS;
  const tempPrefix = `.${patch}.tmp-`;
  const backupPrefix = `.${patch}.old-`;
  for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const isTemp = entry.name.startsWith(tempPrefix);
    const isBackup = entry.name.startsWith(backupPrefix);
    if (!isTemp && !(targetExists && isBackup)) continue;
    const path = join(publicDir, entry.name);
    if (statSync(path).mtimeMs <= staleBefore) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}
