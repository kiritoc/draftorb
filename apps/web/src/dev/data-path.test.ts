import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveDataPath } from './data-path.js';

const root = resolve('/repo/data/public');
const tags = resolve('/repo/data/manual/champion-tags.json');

describe('resolveDataPath', () => {
  it('serves JSON files inside the data root', () => {
    expect(resolveDataPath('/latest.json', root, tags)).toBe(join(root, 'latest.json'));
    expect(resolveDataPath('/16.21/roles/SUPPORT/baseline.json', root, tags)).toBe(
      join(root, '16.21', 'roles', 'SUPPORT', 'baseline.json'),
    );
  });

  it('maps champion-tags.json to the manual tags file', () => {
    expect(resolveDataPath('/champion-tags.json', root, tags)).toBe(tags);
  });

  it('rejects traversal, encoded traversal and backslashes', () => {
    expect(resolveDataPath('/../manual/x.json', root, tags)).toBeNull();
    expect(resolveDataPath('/%2e%2e/%2e%2e/package.json', root, tags)).toBeNull();
    expect(resolveDataPath('/..%2F..%2Fpackage.json', root, tags)).toBeNull();
    expect(resolveDataPath('/..%5C..%5Cpackage.json', root, tags)).toBeNull();
  });

  it('rejects non-JSON files and malformed encodings', () => {
    expect(resolveDataPath('/.env', root, tags)).toBeNull();
    expect(resolveDataPath('/%E0%A4%A.json', root, tags)).toBeNull();
  });
});
