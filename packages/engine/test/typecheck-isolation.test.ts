/**
 * B-021 regression: `types: []` in the engine/shared tsconfigs must keep
 * `@types/node` out of the production type-check program. Test files import
 * vitest, whose type declarations pull `node:*` modules (and therefore
 * `@types/node` globals such as `process`) into any program that includes
 * them, so engine/shared tests live under `packages/engine/test` and
 * `packages/shared/test` — never in `src/` — and the production tsconfigs
 * exclude `*.test.ts` as a guard. This test
 * fails if a test file (or anything else importing vitest/node types) is
 * reintroduced into the production programs.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const NODE_TYPES = /@types[/\\]node[/\\]/;

function programFileNames(tsconfigPath: string): string[] {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsconfigPath));
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  return program.getSourceFiles().map((file) => file.fileName);
}

describe('type-check isolation (B-021)', { timeout: 60_000 }, () => {
  it('engine production program does not load @types/node', () => {
    const files = programFileNames(join(repoRoot, 'packages/engine/tsconfig.json'));
    expect(files.filter((file) => NODE_TYPES.test(file))).toEqual([]);
  });

  it('shared production program does not load @types/node', () => {
    const files = programFileNames(join(repoRoot, 'packages/shared/tsconfig.json'));
    expect(files.filter((file) => NODE_TYPES.test(file))).toEqual([]);
  });
});
