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

async function lintFile(filePath: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint();
  const results = await eslint.lintFiles([filePath]);
  return results ?? [];
}

function hasErrorWithRuleId(results: ESLint.LintResult[], ruleId: string): boolean {
  return results.some((r) => r.messages.some((m) => m.ruleId === ruleId));
}

describe('engine purity lint regression (B-022, B-023, B-017)', () => {
  it('rejects bare Node built-in import (crypto) — B-022', async () => {
    const code =
      'import { createHash } from "crypto";\nexport const probe = createHash("sha256");\n';
    const filePath = writeFixture('crypto-import.ts', code);
    const results = await lintFile(filePath);
    expect(hasErrorWithRuleId(results, 'no-restricted-imports')).toBe(true);
    cleanupFixtures();
  });

  it('rejects bare Node built-in import (net) — B-022', async () => {
    const code = 'import * as net from "net";\nexport const probe = net;\n';
    const filePath = writeFixture('net-import.ts', code);
    const results = await lintFile(filePath);
    expect(hasErrorWithRuleId(results, 'no-restricted-imports')).toBe(true);
    cleanupFixtures();
  });

  it('rejects node: protocol import (node:crypto) — B-022', async () => {
    const code =
      'import { createHash } from "node:crypto";\nexport const probe = createHash("sha256");\n';
    const filePath = writeFixture('node-crypto-import.ts', code);
    const results = await lintFile(filePath);
    expect(hasErrorWithRuleId(results, 'no-restricted-imports')).toBe(true);
    cleanupFixtures();
  });

  it('rejects Date() call (no new) — B-023', async () => {
    const filePath = writeFixture('date-call.ts', 'export const probe = Date();\n');
    const results = await lintFile(filePath);
    expect(hasErrorWithRuleId(results, 'no-restricted-syntax')).toBe(true);
    cleanupFixtures();
  });

  it('rejects new Date() — B-023', async () => {
    const filePath = writeFixture('new-date.ts', 'export const probe = new Date();\n');
    const results = await lintFile(filePath);
    expect(hasErrorWithRuleId(results, 'no-restricted-syntax')).toBe(true);
    cleanupFixtures();
  });

  it('rejects process global — B-017', async () => {
    const filePath = writeFixture('process-global.ts', 'export const probe = process.cwd();\n');
    const results = await lintFile(filePath);
    expect(hasErrorWithRuleId(results, 'no-restricted-globals')).toBe(true);
    cleanupFixtures();
  });

  it('rejects Math.random — B-017', async () => {
    const filePath = writeFixture('math-random.ts', 'export const probe = Math.random();\n');
    const results = await lintFile(filePath);
    expect(hasErrorWithRuleId(results, 'no-restricted-properties')).toBe(true);
    cleanupFixtures();
  });

  it('passes a pure function — guards against overblocking', async () => {
    const filePath = writeFixture(
      'pure.ts',
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    const results = await lintFile(filePath);
    expect(results[0]?.errorCount ?? 0).toBe(0);
    cleanupFixtures();
  });
});
