import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROFILE_EXPORT_SCHEMA_VERSION } from '@draftorb/shared';

import { loadProfile } from './profile';

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

const profileExport = {
  schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
  id: 'test-profile',
  riotId: { gameName: 'Test', tagLine: 'One', platform: 'EUW1' },
  label: "Test's picks",
  syncedAt: 1_760_000_000_000,
  gameCount: 1,
  favorites: { combined: [23], recency: [23], mastery: [] },
  games: [
    {
      createdAtDay: 20_000,
      championId: 23,
      role: 'SUPPORT',
      win: true,
      allyAdcId: 67,
      enemySupportId: 143,
      enemyAdcId: 202,
      enemyChampionIds: [143, 202, 35, 121, 7],
      runes: null,
      items: [2055],
      itemsOrdered: null,
      summonerSpells: [4, 7],
    },
  ],
  mastery: [{ championId: 23, points: 1000, level: 7 }],
};

const profileIndex = {
  schemaVersion: PROFILE_EXPORT_SCHEMA_VERSION,
  profiles: [
    {
      id: 'test-profile',
      riotId: { gameName: 'Test', tagLine: 'One' },
      platform: 'EUW1',
      label: "Test's picks",
      syncedAt: 1_760_000_000_000,
      gameCount: 1,
      file: 'test-profile.json',
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('loadProfile', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
    console.warn = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    vi.restoreAllMocks();
  });

  it('loads index.json then the profile file and validates both', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('profiles/index.json')) return Promise.resolve(jsonResponse(profileIndex));
      if (url.endsWith('profiles/test-profile.json'))
        return Promise.resolve(jsonResponse(profileExport));
      return Promise.resolve(jsonResponse({}, 404));
    });
    const profile = await loadProfile();
    expect(profile?.id).toBe('test-profile');
    expect(profile?.label).toBe("Test's picks");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null and warns when index.json is missing', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, 404));
    expect(await loadProfile()).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns null when the index lists no profiles', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ ...profileIndex, profiles: [] }),
    );
    expect(await loadProfile()).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null when the profile file fails schema validation', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('profiles/index.json')) return Promise.resolve(jsonResponse(profileIndex));
      return Promise.resolve(jsonResponse({ bogus: true }));
    });
    expect(await loadProfile()).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns null when the profile file request fails', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('profiles/index.json')) return Promise.resolve(jsonResponse(profileIndex));
      return Promise.resolve(jsonResponse({}, 500));
    });
    expect(await loadProfile()).toBeNull();
  });
});
