import { cpSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = resolve(appDirectory, '..', '..');
const distributionDirectory = join(appDirectory, 'dist');

cpSync(join(repositoryDirectory, 'data', 'public'), distributionDirectory, {
  recursive: true,
});
copyFileSync(
  join(repositoryDirectory, 'data', 'manual', 'champion-tags.json'),
  join(distributionDirectory, 'champion-tags.json'),
);
