import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadPoolConfig } from './pool-config';

const VALID_POOL = {
  schemaVersion: 1,
  pools: {
    SUPPORT: [{ championId: 267, name: 'Nami' }],
    TOP: [{ championId: 98 }],
  },
};

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'draftorb-pool-config-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadPoolConfig', () => {
  it('returns null when the file does not exist', () => {
    withTempDir((dir) => {
      expect(loadPoolConfig(join(dir, 'pool.config.json'))).toBeNull();
    });
  });

  it('parses a valid pool config file', () => {
    withTempDir((dir) => {
      const path = join(dir, 'pool.config.json');
      writeFileSync(path, JSON.stringify(VALID_POOL));
      const config = loadPoolConfig(path);
      expect(config?.pools.SUPPORT).toEqual([{ championId: 267, name: 'Nami' }]);
      expect(config?.pools.TOP).toEqual([{ championId: 98 }]);
    });
  });

  it('throws on invalid JSON', () => {
    withTempDir((dir) => {
      const path = join(dir, 'pool.config.json');
      writeFileSync(path, '{not json');
      expect(() => loadPoolConfig(path)).toThrow(/not valid JSON/);
    });
  });

  it('throws when the file fails the pool config schema', () => {
    withTempDir((dir) => {
      const path = join(dir, 'pool.config.json');
      writeFileSync(path, JSON.stringify({ schemaVersion: 2, pools: {} }));
      expect(() => loadPoolConfig(path)).toThrow();
    });
  });
});
