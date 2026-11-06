/**
 * Secret-leak check tests (T-092, TESTING.md): a planted `RGAPI-` key or the
 * configured key value fails the check; placeholders, fixtures and the real
 * tree pass; the secret value is never printed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(repoRoot, 'scripts', 'check-secrets.mjs');

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-secrets-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function runCheck(args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const PLANTED_KEY = 'RGAPI-abcdef1234567890abcdef1234567890abcdef12';

describe('check-secrets', () => {
  it('fails on a planted RGAPI- key in a scanned file', () => {
    const root = tempDir();
    writeFileSync(join(root, 'leak.txt'), `token = ${PLANTED_KEY}\n`);
    const result = runCheck(['--root', root, '--dist', 'off']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('leak.txt');
    expect(result.stderr).toContain('RGAPI- key pattern');
    expect(result.stderr).not.toContain(PLANTED_KEY);
  });

  it('fails on the literal RIOT_API_KEY value without printing it', () => {
    const root = tempDir();
    const key = 'RGAPI-real-key-value-should-never-print';
    writeFileSync(join(root, 'bundle.js'), `var k="${key}";`);
    const result = runCheck(['--root', root, '--dist', 'off'], { RIOT_API_KEY: key });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('RIOT_API_KEY value');
    expect(result.stderr).not.toContain(key);
  });

  it('passes on placeholders and test fixtures that only look like keys', () => {
    const root = tempDir();
    writeFileSync(
      join(root, 'fixtures.txt'),
      [
        'RIOT_API_KEY=RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        "const k = 'RGAPI-test-api-key-12345';",
        "const u = 'RGAPI-1a2b3c4d-1234-5678-9abc-def012345678';",
        'mentions RGAPI- in prose only',
      ].join('\n'),
    );
    const result = runCheck(['--root', root, '--dist', 'off']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('passed');
  });

  it('scans the dist directory when present', () => {
    const root = tempDir();
    const dist = join(root, 'apps', 'web', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'app.js'), `key=${PLANTED_KEY}`);
    const result = runCheck(['--root', root]);
    expect(result.status).toBe(1);
    expect(result.stderr.replace(/\\/g, '/')).toContain('apps/web/dist/app.js');
  });

  it('passes on the real repository tree', () => {
    // Uses git ls-files + apps/web/dist if a build exists; the committed tree
    // only contains placeholders and redaction fixtures.
    const result = runCheck(['--root', repoRoot]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('passed');
  });

  it('module API returns findings without secret values', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.txt'), PLANTED_KEY);
    const { findSecretLeaks } = await import('./check-secrets.mjs');
    const findings = findSecretLeaks(root, null, {});
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('a.txt');
    expect(findings[0]).not.toContain(PLANTED_KEY);
  });
});
