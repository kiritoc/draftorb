/**
 * @draftorb/web — Dev data-server path resolution (pure, testable).
 *
 * Maps a request pathname to a file under `dataRoot`, or to the manual
 * champion tags file. Returns null for anything that is not a `.json` file
 * inside the allowed tree (blocks path traversal, CWE-22).
 */

import { resolve, sep } from 'node:path';

export function resolveDataPath(
  rawPathname: string,
  dataRoot: string,
  championTagsPath: string,
): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }
  if (
    !pathname.endsWith('.json') ||
    pathname.includes('..') ||
    pathname.includes('\\') ||
    pathname.includes('\0')
  ) {
    return null;
  }
  if (pathname === '/champion-tags.json') {
    return championTagsPath;
  }
  const root = resolve(dataRoot);
  const filePath = resolve(root, pathname.replace(/^\/+/, ''));
  return isInside(filePath, root) ? filePath : null;
}

function isInside(filePath: string, root: string): boolean {
  return filePath.startsWith(root + sep);
}

/**
 * Symlink-safe containment check: resolves both paths to their real location
 * (following symlinks) and requires the file to stay inside the real root.
 * `realpath` is injectable for tests; returns false when either path is missing.
 */
export function isRealPathInside(
  filePath: string,
  root: string,
  realpath: (path: string) => string,
): boolean {
  try {
    return isInside(realpath(filePath), realpath(root));
  } catch {
    return false;
  }
}
