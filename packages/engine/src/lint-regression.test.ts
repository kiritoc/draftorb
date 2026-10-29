import { describe, it, expect, afterEach } from 'vitest';
import { ESLint } from 'eslint';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const fixturesDir = join(__dirname, '__lint_test__');

function writeFixture(name: string, content: string): string {
  mkdirSync(fixturesDir, { recursive: true });
  const filePath = join(fixturesDir, name);
  writeFileSync(filePath, content);
  return filePath;
}

function cleanupFixtures(): void {
  if (existsSync(fixturesDir)) {
    rmSync(fixturesDir, { recursive: true });
  }
}

afterEach(() => {
  cleanupFixtures();
});

async function lintFile(filePath: string): Promise<number> {
  const eslint = new ESLint();
  const results = await eslint.lintFiles([filePath]);
  return results[0]?.errorCount ?? 0;
}

describe('engine purity lint regression (B-022, B-023, B-017)', () => {
  it('rejects bare Node built-in import (crypto) — B-022', async () => {
    const filePath = writeFixture('crypto-import.ts', 'import { createHash } from "crypto";\n');
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBeGreaterThan(0);
    cleanupFixtures();
  });

  it('rejects bare Node built-in import (net) — B-022', async () => {
    const filePath = writeFixture('net-import.ts', 'import net from "net";\n');
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBeGreaterThan(0);
    cleanupFixtures();
  });

  it('rejects node: protocol import (node:crypto) — B-022', async () => {
    const filePath = writeFixture(
      'node-crypto-import.ts',
      'import { createHash } from "node:crypto";\n',
    );
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBeGreaterThan(0);
    cleanupFixtures();
  });

  it('rejects Date() call (no new) — B-023', async () => {
    const filePath = writeFixture('date-call.ts', 'export const probe = Date();\n');
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBeGreaterThan(0);
    cleanupFixtures();
  });

  it('rejects new Date() — B-023', async () => {
    const filePath = writeFixture('new-date.ts', 'export const probe = new Date();\n');
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBeGreaterThan(0);
    cleanupFixtures();
  });

  it('rejects process global — B-017', async () => {
    const filePath = writeFixture('process-global.ts', 'export const probe = process.cwd();\n');
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBeGreaterThan(0);
    cleanupFixtures();
  });

  it('rejects Math.random — B-017', async () => {
    const filePath = writeFixture('math-random.ts', 'export const probe = Math.random();\n');
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBeGreaterThan(0);
    cleanupFixtures();
  });

  it('passes a pure function — guards against overblocking', async () => {
    const filePath = writeFixture(
      'pure.ts',
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    const errorCount = await lintFile(filePath);
    expect(errorCount).toBe(0);
    cleanupFixtures();
  });
});
