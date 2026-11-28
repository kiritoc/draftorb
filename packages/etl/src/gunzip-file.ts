import { createReadStream, createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

/**
 * Streams a gzip file to `destPath` without buffering it in memory. `etl pull
 * --db` needs this because the ~5.6 GB `DraftOrb.sqlite` exceeds the Node
 * Buffer length limit, so `gunzipSync`/`readFileSync` crash (B-083).
 *
 * Writes to a sibling `.partial` temp file and renames it into place, so a
 * failed or interrupted decompress never leaves a truncated file at
 * `destPath`. The rename is atomic because the temp file lives in the same
 * directory (same filesystem) and `fs.rename` replaces an existing
 * destination on both Windows and POSIX.
 */
// Distinguishes concurrent calls in the same process (two pulls writing to
// the same destination would otherwise share one temp path).
let partialCounter = 0;

export async function gunzipFile(sourcePath: string, destPath: string): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const tmpPath = join(
    dirname(destPath),
    `.${basename(destPath)}.partial-${process.pid}-${partialCounter++}`,
  );
  try {
    await pipeline(createReadStream(sourcePath), createGunzip(), createWriteStream(tmpPath));
    renameSync(tmpPath, destPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}
