import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// B-056: the web tsconfig references the composite packages/shared and
// packages/engine projects, so `tsc` resolves their entry points to
// `dist/*.d.ts`. A plain `tsc --noEmit` fails on a clean checkout (TS6305)
// unless the referenced projects are built first. The scripts must therefore
// use build mode (`tsc -b`), which builds the references before checking.
const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const { scripts } = JSON.parse(readFileSync(join(appDirectory, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('web package scripts (B-056)', () => {
  it('builds project references before the production build steps', () => {
    const build = scripts['build'] ?? '';
    const tscIndex = build.indexOf('tsc -b');
    const viteIndex = build.indexOf('vite build');
    expect(tscIndex).toBeGreaterThanOrEqual(0);
    expect(viteIndex).toBeGreaterThan(tscIndex);
  });

  it('typechecks in build mode so referenced declarations exist', () => {
    expect(scripts['typecheck']).toContain('tsc -b');
  });
});
