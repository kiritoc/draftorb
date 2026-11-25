import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORBIDDEN = [
  'RIOT_API_KEY',
  'RGAPI-',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'Authorization',
  'Bearer ',
];

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

describe('desktop app credentials (BL-010a)', () => {
  const targets = [
    ...files(join(desktopRoot, 'ui', 'src')),
    ...files(join(desktopRoot, 'src-tauri', 'src')),
    ...files(join(desktopRoot, 'src-tauri', 'capabilities')),
    join(desktopRoot, 'src-tauri', 'tauri.conf.json'),
    join(desktopRoot, 'src-tauri', 'Cargo.toml'),
  ].filter((file) => file !== fileURLToPath(import.meta.url));

  it('scans the app sources and config', () => {
    expect(targets.length).toBeGreaterThan(10);
  });

  it.each(FORBIDDEN)('contains no %s', (token) => {
    const hits = targets.filter((file) => readFileSync(file, 'utf8').includes(token));
    expect(hits).toEqual([]);
  });
});
