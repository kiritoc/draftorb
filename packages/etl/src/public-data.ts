import { rmSync } from 'node:fs';
import { join } from 'node:path';

/** Removes a patch manifest before its catalog files are updated. */
export function invalidateManifest(patchDir: string): void {
  rmSync(join(patchDir, 'manifest.json'), { force: true });
}
