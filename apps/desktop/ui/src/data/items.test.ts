/**
 * Item catalog loader tests (BL-031b): `<patch>/items.json` name/icon
 * resolution with the same degrade/fail-closed contract as runes.json.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./aggregates', () => ({
  cacheRead: vi.fn(),
}));

import { cacheRead as readDataFile } from './aggregates';
import { buildItemIndex, itemIconUrl, loadItemCatalog } from './items';

const mockRead = vi.mocked(readDataFile);
const PATCH = '16.22';

const ITEMS_JSON = {
  '2052': {
    id: 2052,
    name: "Doran's Blade",
    icon: '2052.png',
    goldTotal: 450,
    purchasable: true,
    tags: [],
    from: [],
    into: [],
    stats: {},
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadItemCatalog', () => {
  it('returns null when nothing is cached', async () => {
    mockRead.mockResolvedValue(null);
    expect(await loadItemCatalog(PATCH)).toBeNull();
  });

  it('parses the item catalog', async () => {
    mockRead.mockResolvedValue(JSON.stringify(ITEMS_JSON));
    const items = await loadItemCatalog(PATCH);
    expect(items?.['2052']?.name).toBe("Doran's Blade");
    expect(mockRead).toHaveBeenCalledWith(`${PATCH}/items.json`);
  });

  it('throws on a corrupt catalog (fail-closed)', async () => {
    mockRead.mockResolvedValue('{not json');
    await expect(loadItemCatalog(PATCH)).rejects.toThrow();
  });
});

describe('buildItemIndex / itemIconUrl', () => {
  it('indexes items by id for name/icon lookup', async () => {
    mockRead.mockResolvedValue(JSON.stringify(ITEMS_JSON));
    const items = await loadItemCatalog(PATCH);
    if (items === null) throw new Error('expected catalog');
    const index = buildItemIndex(items);
    expect(index.get(2052)).toEqual({ id: 2052, name: "Doran's Blade", icon: '2052.png' });
    expect(index.get(9999)).toBeUndefined();
  });

  it('builds the CDN item icon URL and degrades without a version', () => {
    expect(itemIconUrl('16.22.1', '2052.png')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.22.1/img/item/2052.png',
    );
    expect(itemIconUrl(null, '2052.png')).toBeNull();
    expect(itemIconUrl('16.22.1', '')).toBeNull();
  });
});
