import { existsSync } from 'node:fs';
import { cpSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = resolve(appDirectory, '..', '..');
const distributionDirectory = join(appDirectory, 'dist');

// data/public is gitignored (D-079): it is populated by `pnpm etl pull` or a
// local export. A clean checkout (e.g. CI) has no exports — the app fetches
// them at runtime, so the build must not fail on their absence.
const publicDataDir = join(repositoryDirectory, 'data', 'public');
if (existsSync(publicDataDir)) {
  cpSync(publicDataDir, distributionDirectory, { recursive: true });
} else {
  console.warn('data/public not found; skipping export copy (run `pnpm etl pull`)');
}
copyFileSync(
  join(repositoryDirectory, 'data', 'manual', 'champion-tags.json'),
  join(distributionDirectory, 'champion-tags.json'),
);
