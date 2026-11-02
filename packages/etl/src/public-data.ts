import { rmSync } from 'node:fs';
import { join } from 'node:path';

export function invalidateManifest(patchDir: string): void {
  rmSync(join(patchDir, 'manifest.json'), { force: true });
}
