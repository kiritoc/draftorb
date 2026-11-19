import type { ProfileExport, ProfileGame, Role } from '@draftorb/shared';

/** Minimal valid profile export for tests. */
export function makeProfile(
  games: Array<{ championId: number; role: Role; win: boolean }>,
  overrides: Partial<ProfileExport> = {},
): ProfileExport {
  const full: ProfileGame[] = games.map((g) => ({
    createdAtDay: 20000,
    championId: g.championId,
    role: g.role,
    win: g.win,
    allyAdcId: null,
    enemySupportId: null,
    enemyAdcId: null,
    enemyChampionIds: [],
    runes: null,
    items: [],
    itemsOrdered: null,
    summonerSpells: [4, 14],
  }));
  return {
    schemaVersion: 1,
    id: 'kiritoctoc-euw1',
    riotId: { gameName: 'KiriToc', tagLine: 'Toc', platform: 'EUW1' },
    label: "KiriToc's picks",
    syncedAt: 1794900000,
    gameCount: full.length,
    favorites: { combined: [], recency: [], mastery: [] },
    games: full,
    mastery: [],
    ...overrides,
  };
}

export function makeIndex(file = 'kiritoctoc-euw1.json') {
  return {
    schemaVersion: 1,
    profiles: [
      {
        id: 'kiritoctoc-euw1',
        riotId: { gameName: 'KiriToc', tagLine: 'Toc' },
        platform: 'EUW1',
        label: "KiriToc's picks",
        syncedAt: 1794900000,
        gameCount: 0,
        file,
      },
    ],
  };
}
