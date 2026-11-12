import { describe, expect, it } from 'vitest';

import type { RawDDragonItem } from './ddragon';
import { buildItemClasses, classifyItem } from './item-classes';

const item = (over: Partial<RawDDragonItem>): RawDDragonItem => ({
  name: 'test',
  tags: [],
  from: [],
  into: [],
  stats: {},
  gold: { purchasable: true, total: 1000 },
  maps: { '11': true },
  ...over,
});

describe('classifyItem', () => {
  it('classifies a laning starter (Doran-style, Lane tag, no into)', () => {
    expect(classifyItem(1055, item({ name: "Doran's Shield", tags: ['Health', 'Lane'] }))).toEqual({
      cls: 'starter',
    });
  });

  it('classifies World Atlas as quest_line/support', () => {
    expect(classifyItem(3865, item({ name: 'World Atlas', tags: ['Lane', 'Quest'] }))).toEqual({
      cls: 'quest_line',
      laneFamily: 'support',
    });
  });

  it('classifies each support quest reward id as quest_reward', () => {
    for (const id of [3869, 3870, 3871, 3876, 3877]) {
      expect(classifyItem(id, item({ name: `reward-${id}`, tags: ['Lane'] })).cls).toBe(
        'quest_reward',
      );
    }
  });

  it('classifies jungle pets as jungle_path', () => {
    expect(classifyItem(1101, item({ name: 'Gustwalker', tags: ['Jungle', 'Pet'] })).cls).toBe(
      'jungle_path',
    );
  });

  it('classifies boots as boots', () => {
    expect(classifyItem(1001, item({ name: 'Boots', tags: ['Boots'] })).cls).toBe('boots');
  });

  it('classifies a legendary with empty into as completed', () => {
    expect(classifyItem(3031, item({ name: 'Infinity Edge', tags: ['CriticalStrike'] })).cls).toBe(
      'completed',
    );
  });

  it('classifies a build component as component', () => {
    expect(
      classifyItem(1036, item({ name: 'Long Sword', tags: ['Damage'], into: ['3031'] })).cls,
    ).toBe('component');
  });

  it('classifies consumables as consumable', () => {
    expect(classifyItem(2003, item({ name: 'Health Potion', tags: ['Consumable'] })).cls).toBe(
      'consumable',
    );
    expect(
      classifyItem(2055, item({ name: 'Control Ward', tags: ['Consumable', 'Trinket'] })).cls,
    ).toBe('consumable');
  });

  it('excludes non-SR and hidden items', () => {
    expect(classifyItem(9999, item({ maps: { '30': true } })).cls).toBe('excluded');
    expect(classifyItem(9998, item({ hideFromAll: true })).cls).toBe('excluded');
  });

  it('buildItemClasses covers every named raw item', () => {
    const classes = buildItemClasses({
      '3865': item({ name: 'World Atlas', tags: ['Lane', 'Quest'] }),
      '1101': item({ name: 'Gustwalker', tags: ['Jungle', 'Pet'] }),
    });
    expect(classes['3865']?.cls).toBe('quest_line');
    expect(classes['1101']?.cls).toBe('jungle_path');
  });
});

describe('generated file completeness (CI)', () => {
  it('data/item-classes.generated.json parses and covers the taxonomy invariants', async () => {
    const { readFileSync } = await import('node:fs');
    const { generatedClassesPath } = await import('./item-classes');
    const { itemClassesExportSchema } = await import('@draftorb/shared');
    const raw = JSON.parse(readFileSync(generatedClassesPath(), 'utf8')) as {
      patch?: string;
      items?: Record<string, { cls: string; laneFamily?: string }>;
    };
    const parsed = itemClassesExportSchema.parse({
      patch: raw.patch ?? 'unknown',
      items: raw.items ?? {},
    });
    expect(Object.keys(parsed.items).length).toBeGreaterThan(500);
    // Invariants: quest rewards never completed; pets never completed;
    // Atlas is quest_line; boots are boots.
    for (const id of ['3869', '3870', '3871', '3876', '3877']) {
      expect(parsed.items[id]?.cls).toBe('quest_reward');
    }
    expect(parsed.items['3865']?.cls).toBe('quest_line');
    expect(parsed.items['1101']?.cls).toBe('jungle_path');
    expect(parsed.items['1001']?.cls).toBe('boots');
    // No gameplay class may be 'excluded' for known SR items.
    expect(parsed.items['3031']?.cls).toBe('completed');
  });
});
