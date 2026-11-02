import { RUNE_CONTEXT_LEVELS } from '@draftorb/shared';
import type { BaselineSeed, ItemBuildSeed, RuneCtxSeed } from './export.seed.js';

export { seed } from './export.seed.js';

export function supportBaselineRow(overrides: Partial<BaselineSeed> = {}): BaselineSeed {
  return {
    championId: 412,
    myRole: 'SUPPORT',
    rankBucket: 'IRON',
    winsW: 6,
    gamesW: 10,
    gamesW2: 10,
    games: 3,
    ...overrides,
  };
}

export function supportRuneRow(overrides: Partial<RuneCtxSeed> = {}): RuneCtxSeed {
  return {
    championId: 412,
    myRole: 'SUPPORT',
    contextKey: 'global',
    contextLevel: RUNE_CONTEXT_LEVELS.global,
    perksHash: 'support',
    perksJson: validPerksJson,
    winsW: 6,
    gamesW: 10,
    gamesW2: 10,
    players: 2,
    ...overrides,
  };
}

export function supportBuildRow(overrides: Partial<ItemBuildSeed> = {}): ItemBuildSeed {
  return {
    championId: 412,
    myRole: 'SUPPORT',
    slotIdx: 1,
    timeBucket: '0-5',
    stateBucket: 'even',
    profileKey: 'AD',
    laneKey: null,
    itemId: 3340,
    winsW: 6,
    gamesW: 10,
    gamesW2: 10,
    ...overrides,
  };
}

export const validPerksJson = JSON.stringify({
  statPerks: { offense: 5008, defense: 5005, flex: 5008 },
  styles: [
    { style: 8400, selections: [{ perk: 8439 }, { perk: 8453 }, { perk: 8465 }, { perk: 8473 }] },
    { style: 8100, selections: [{ perk: 9111 }, { perk: 9104 }] },
  ],
});
