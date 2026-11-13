import { describe, expect, it } from 'vitest';

import type {
  ChampionTagsMap,
  GameState,
  ItemBuildExport,
  ItemClassesExport,
  ItemsMap,
  PlayerState,
  Role,
} from '@draftorb/shared';

import {
  analyticItemPower,
  DEFAULT_CONFIG,
  DEFAULT_ITEMS_CONFIG,
  DEFAULT_LANE_GROUPS,
  deriveItemContext,
  itemLaneKey,
  ownedCompletedCount,
  recommendItems,
} from '../src/index.js';
import type { ItemContext } from '../src/index.js';

const SUPPORT: Role = 'SUPPORT';

function player(
  championId: number,
  items: number[] = [],
  kd = { kills: 0, deaths: 0, assists: 0 },
): PlayerState {
  return { championId, kills: kd.kills, deaths: kd.deaths, assists: kd.assists, items };
}

function gameState(over: Partial<GameState> = {}): GameState {
  return {
    time: 600,
    me: player(412, []),
    allies: [player(110)],
    enemies: [player(235), player(804), player(1), player(3), player(5)],
    goldDiff: 0,
    kills: 0,
    ...over,
  };
}

const ITEMS: ItemsMap = {
  '1001': {
    id: 1001,
    name: 'Boots',
    icon: 'b.png',
    goldTotal: 300,
    purchasable: true,
    tags: ['Boots'],
    from: [],
    into: [],
    stats: { FlatMovementSpeedMod: 25 },
  },
  '3047': {
    id: 3047,
    name: 'Plated Steelcaps',
    icon: 'p.png',
    goldTotal: 1100,
    purchasable: true,
    tags: [],
    from: [1001],
    into: [],
    stats: { FlatArmorMod: 15 },
  },
  '3083': {
    id: 3083,
    name: 'Warmog',
    icon: 'w.png',
    goldTotal: 2800,
    purchasable: true,
    tags: [],
    from: [],
    into: [],
    stats: { FlatHPPoolMod: 400, FlatHPRegenMod: 5 },
  },
  '3085': {
    id: 3085,
    name: 'Runic Compendium',
    icon: 'r.png',
    goldTotal: 900,
    purchasable: true,
    tags: [],
    from: [],
    into: [],
    stats: { FlatMPPoolMod: 300 },
  },
  '3131': {
    id: 3131,
    name: 'Divine Sunderer',
    icon: 'd.png',
    goldTotal: 3000,
    purchasable: true,
    tags: [],
    from: [],
    into: [],
    stats: { FlatPhysicalDamageMod: 40 },
  },
};

const CLASSES: ItemClassesExport = {
  patch: '16.22',
  items: {
    '1001': { cls: 'boots' },
    '3047': { cls: 'completed' },
    '3083': { cls: 'completed' },
    '3085': { cls: 'completed' },
    '3131': { cls: 'completed' },
  },
};

const CLASS_MAP = new Map<number, { cls: string }>(
  Object.entries(CLASSES.items).map(([id, e]) => [Number(id), { cls: e.cls }]),
);

const CHAMP_TAGS: ChampionTagsMap = {
  '110': {
    championId: 110,
    damageType: 'AD',
    archetype: 'adc',
    hardEngage: false,
    peel: false,
    poke: true,
    waveclear: true,
    scaling: { early: true, mid: true, late: true },
    range: 'RANGED',
    ccCount: 0,
  },
  '235': {
    championId: 235,
    damageType: 'AP',
    archetype: 'support',
    hardEngage: true,
    peel: true,
    poke: false,
    waveclear: false,
    scaling: { early: true, mid: false, late: false },
    range: 'MELEE',
    ccCount: 2,
  },
  '804': {
    championId: 804,
    damageType: 'AD',
    archetype: 'adc',
    hardEngage: false,
    peel: false,
    poke: true,
    waveclear: true,
    scaling: { early: true, mid: true, late: true },
    range: 'RANGED',
    ccCount: 0,
  },
  '412': {
    championId: 412,
    damageType: 'NONE',
    archetype: 'support',
    hardEngage: true,
    peel: true,
    poke: false,
    waveclear: false,
    scaling: { early: true, mid: true, late: true },
    range: 'MELEE',
    ccCount: 1,
  },
};

type BuildCtx = ItemBuildExport['contexts'][number];

function bctx(partial: Partial<BuildCtx> & Pick<BuildCtx, 'slotIdx'>): BuildCtx {
  return {
    timeBucket: '10-15',
    stateBucket: 'even',
    profileKey: 'mixed',
    items: [],
    ...partial,
  };
}

function buildExport(contexts: ItemBuildExport['contexts']): ItemBuildExport {
  return { championId: 412, myRole: SUPPORT, contexts };
}

function itemCtx(partial: Partial<ItemContext> = {}): ItemContext {
  return {
    slotIdx: 1,
    timeBucket: '10-15',
    stateBucket: 'even',
    profileKey: 'mixed',
    laneKey: '',
    laneArch: '',
    phase: 'mid',
    threatShares: [0.2, 0.2, 0.2, 0.2, 0.2],
    fedEnemyIdx: [],
    ...partial,
  };
}

describe('ownedCompletedCount', () => {
  it('counts only completed/boots classes', () => {
    expect(ownedCompletedCount([3047, 1001, 5001], CLASS_MAP)).toBe(2);
    expect(ownedCompletedCount([3047, 1001], undefined)).toBe(2);
  });
});

describe('itemLaneKey', () => {
  it('formats influence-sorted slots like the ETL laneKeyOf', () => {
    const lane = {
      allies: [{ role: 'ADC' as Role, championId: 110 }],
      enemies: [
        { role: 'SUPPORT' as Role, championId: 235 },
        { role: 'ADC' as Role, championId: 804 },
      ],
    };
    const key = itemLaneKey(SUPPORT, lane, DEFAULT_LANE_GROUPS, DEFAULT_CONFIG);
    expect(key.startsWith('lane:')).toBe(true);
    // SUPPORT lane group: ally ADC + enemy SUPPORT/ADC, influence-sorted.
    expect(key).toContain('a.ADC:110');
    expect(key).toContain('e.SUPPORT:235');
    expect(key).toContain('e.ADC:804');
  });

  it('returns empty string without lane context or lane groups', () => {
    expect(itemLaneKey(SUPPORT, undefined, DEFAULT_LANE_GROUPS, DEFAULT_CONFIG)).toBe('');
    expect(itemLaneKey(SUPPORT, { allies: [], enemies: [] }, undefined, DEFAULT_CONFIG)).toBe('');
  });
});

describe('deriveItemContext', () => {
  it('derives slot, time bucket, state bucket and enemy profile', () => {
    const c = deriveItemContext(
      gameState({ me: player(412, [3047]), goldDiff: -3000, kills: -4 }),
      SUPPORT,
      { itemClasses: CLASS_MAP, championTags: CHAMP_TAGS },
    );
    expect(c.slotIdx).toBe(1); // one completed item owned
    expect(c.timeBucket).toBe('10-15');
    expect(c.stateBucket).toBe('behind');
    // Enemies: 235=AP, 804=AD, 1/3/5 untagged -> mixed profile.
    expect(c.profileKey).toBe('mixed');
  });

  it('marks lane phase for slot 0 and early slot 1', () => {
    const c0 = deriveItemContext(gameState({ time: 300 }), SUPPORT, {
      itemClasses: CLASS_MAP,
      championTags: CHAMP_TAGS,
    });
    expect(c0.phase).toBe('lane');
    expect(c0.slotIdx).toBe(0);

    const c1 = deriveItemContext(gameState({ time: 700, me: player(412, [3047]) }), SUPPORT, {
      itemClasses: CLASS_MAP,
      championTags: CHAMP_TAGS,
    });
    expect(c1.phase).toBe('lane'); // slot 1 bought before laneEndSeconds (840)
    expect(c1.slotIdx).toBe(1);

    const c2 = deriveItemContext(gameState({ time: 900, me: player(412, [3047]) }), SUPPORT, {
      itemClasses: CLASS_MAP,
      championTags: CHAMP_TAGS,
    });
    expect(c2.phase).toBe('mid');
  });

  it('uses lane: key only in lane phase', () => {
    const lane = {
      allies: [{ role: 'ADC' as Role, championId: 110 }],
      enemies: [
        { role: 'SUPPORT' as Role, championId: 235 },
        { role: 'ADC' as Role, championId: 804 },
      ],
    };
    const cLane = deriveItemContext(gameState({ time: 300 }), SUPPORT, {
      itemClasses: CLASS_MAP,
      championTags: CHAMP_TAGS,
      lane,
    });
    expect(cLane.laneKey).not.toBe('');

    const cMid = deriveItemContext(
      gameState({ time: 1200, me: player(412, [3047, 3083]) }),
      SUPPORT,
      {
        itemClasses: CLASS_MAP,
        championTags: CHAMP_TAGS,
        lane,
      },
    );
    expect(cMid.phase).toBe('mid');
    expect(cMid.laneKey).toBe('');
  });
});

describe('analyticItemPower', () => {
  it('values armor items higher when behind with fed enemies', () => {
    const armor = ITEMS['3047'] as NonNullable<(typeof ITEMS)[string]>;
    const base = analyticItemPower(armor, itemCtx({}), undefined, DEFAULT_ITEMS_CONFIG);
    const behind = analyticItemPower(
      armor,
      itemCtx({ stateBucket: 'behind', fedEnemyIdx: [0] }),
      undefined,
      DEFAULT_ITEMS_CONFIG,
    );
    expect(behind).toBeGreaterThan(base);
  });

  it('values AD items higher when ahead', () => {
    const ad = ITEMS['3131'] as NonNullable<(typeof ITEMS)[string]>;
    const even = analyticItemPower(ad, itemCtx({}), undefined, DEFAULT_ITEMS_CONFIG);
    const ahead = analyticItemPower(
      ad,
      itemCtx({ stateBucket: 'ahead' }),
      undefined,
      DEFAULT_ITEMS_CONFIG,
    );
    expect(ahead).toBeGreaterThan(even);
  });
});

describe('recommendItems — data layer', () => {
  const slot1Context = bctx({
    slotIdx: 1,
    items: [
      { itemId: 3047, winsW: 40, gamesW: 50, gamesW2: 50, winrate: 0.8, pickShare: 0.4 },
      { itemId: 3083, winsW: 10, gamesW: 50, gamesW2: 50, winrate: 0.2, pickShare: 0.4 },
      { itemId: 3085, winsW: 25, gamesW: 50, gamesW2: 50, winrate: 0.5, pickShare: 0.2 },
    ],
  });

  it('ranks items by shrunk win rate vs context average', () => {
    // me owns 3131 (completed) -> slotIdx 1; 3047/3083 are candidates.
    const state = gameState({ me: player(412, [3131]), time: 800 });
    const result = recommendItems({
      state,
      myRole: SUPPORT,
      build: buildExport([slot1Context]),
      items: ITEMS,
      itemClasses: CLASSES,
      championTags: CHAMP_TAGS,
      itemsConfig: { ...DEFAULT_ITEMS_CONFIG, topItems: 2, avoidItems: 2 },
    });
    expect(result.dataAvailable).toBe(true);
    expect(result.picks[0]?.itemId).toBe(3047);
    expect(result.picks[0]?.source).toBe('data');
    expect(result.picks[0]?.score).toBeGreaterThan(0);
    expect(result.avoid.map((p) => p.itemId)).toContain(3083);
    expect(result.avoid.map((p) => p.itemId)).not.toContain(result.picks[0]?.itemId ?? -1);
  });

  it('excludes already-owned and non-eligible-class items', () => {
    const state = gameState({ me: player(412, [3131]), time: 800 });
    const result = recommendItems({
      state,
      myRole: SUPPORT,
      build: buildExport([slot1Context]),
      items: ITEMS,
      itemClasses: CLASSES,
      championTags: CHAMP_TAGS,
    });
    const ids = result.picks.map((p) => p.itemId);
    expect(ids).not.toContain(3131); // owned
    expect(ids).not.toContain(1001); // boots not eligible at slot>=1
    expect(result.alreadyOwned).toContain(3131);
  });

  it('falls back to broader context levels when the specific one lacks data', () => {
    // Only a championSlot-level context (no dims) with enough games.
    const broad = bctx({
      slotIdx: 1,
      timeBucket: '0-5',
      stateBucket: 'ahead',
      profileKey: 'AP',
      items: [{ itemId: 3083, winsW: 45, gamesW: 50, gamesW2: 50, winrate: 0.9, pickShare: 1 }],
    });
    const state = gameState({ me: player(412, [3131]), time: 800 });
    const result = recommendItems({
      state,
      myRole: SUPPORT,
      build: buildExport([broad]),
      items: ITEMS,
      itemClasses: CLASSES,
      championTags: CHAMP_TAGS,
    });
    expect(result.dataAvailable).toBe(true);
    expect(result.picks[0]?.contextLevel).toBe('championSlot');
    expect(result.picks[0]?.itemId).toBe(3083);
  });

  it('ignores a build export for a different champion or role', () => {
    const wrong = { ...buildExport([slot1Context]), championId: 999 };
    const state = gameState({ me: player(412, [3131]), time: 800 });
    const result = recommendItems({
      state,
      myRole: SUPPORT,
      build: wrong,
      items: ITEMS,
      itemClasses: CLASSES,
      championTags: CHAMP_TAGS,
    });
    // Data layer skipped -> analytic fallback.
    expect(result.picks.every((p) => p.source === 'analytic')).toBe(true);
  });

  it('uses the analytic fallback when no context clears minGames', () => {
    const tiny = bctx({
      slotIdx: 1,
      items: [{ itemId: 3047, winsW: 1, gamesW: 2, gamesW2: 2, winrate: 0.5, pickShare: 1 }],
    });
    const state = gameState({ me: player(412, [3131]), time: 800 });
    const result = recommendItems({
      state,
      myRole: SUPPORT,
      build: buildExport([tiny]),
      items: ITEMS,
      itemClasses: CLASSES,
      championTags: CHAMP_TAGS,
    });
    expect(result.picks.length).toBeGreaterThan(0);
    expect(result.picks.every((p) => p.source === 'analytic')).toBe(true);
    expect(result.dataAvailable).toBe(true);
  });

  it('returns insufficient data when analytic is disabled and data is sparse', () => {
    const tiny = bctx({
      slotIdx: 1,
      items: [{ itemId: 3047, winsW: 1, gamesW: 2, gamesW2: 2, winrate: 0.5, pickShare: 1 }],
    });
    const state = gameState({ me: player(412, [3131]), time: 800 });
    const result = recommendItems({
      state,
      myRole: SUPPORT,
      build: buildExport([tiny]),
      items: ITEMS,
      itemClasses: CLASSES,
      championTags: CHAMP_TAGS,
      itemsConfig: { ...DEFAULT_ITEMS_CONFIG, analyticEnabled: false },
    });
    expect(result.picks).toHaveLength(0);
    expect(result.dataAvailable).toBe(false);
  });
});
