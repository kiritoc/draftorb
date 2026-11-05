import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChampionTagsMap } from '@draftorb/shared';

import { migrate } from '../db';
import { buildRoleRecommendData, loadChampionTagsMap } from './recommend-data';

const TAGS: ChampionTagsMap = {
  '412': {
    championId: 412,
    damageType: 'AP',
    archetype: 'mage',
    hardEngage: false,
    peel: false,
    poke: true,
    waveclear: true,
    scaling: { early: false, mid: true, late: true },
    range: 'RANGED',
    ccCount: 1,
  },
};

describe('buildRoleRecommendData', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-backtest-data-'));
    db = new Database(join(directory, 'test.sqlite'));
    migrate(db);
    // n_eff = gamesW^2 / gamesW2: (50^2)/0.1 = 25000 passes; (1^2)/1 = 1 fails.
    db.prepare(
      `INSERT INTO baseline (champion_id, my_role, rank_bucket, wins_w, games_w, games_w2, games) VALUES
         (412, 'SUPPORT', 'DIAMOND', 30, 50, 0.1, 50),
         (412, 'TOP', 'DIAMOND', 20, 50, 0.1, 50),
         (413, 'SUPPORT', 'DIAMOND', 1, 1, 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO role_prob (champion_id, role, games, games_w, games_w2, prob) VALUES
         (412, 'SUPPORT', 10, 10, 10, 0.8),
         (412, 'TOP', 10, 2.5, 2.5, 0.2)`,
    ).run();
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('builds export-shaped per-role tables with the exportMinGames gate', () => {
    const data = buildRoleRecommendData(db, {
      exportMinGames: 10,
      tags: TAGS,
      championIds: [412, 413],
    });

    // SUPPORT keeps its gated row; the n_eff=1 row is dropped.
    expect(data.SUPPORT?.baselines).toEqual([[412, 'DIAMOND', 30, 50, 0.1, 50]]);
    // TOP has its own row; JUNGLE has none.
    expect(data.TOP?.baselines).toEqual([[412, 'DIAMOND', 20, 50, 0.1, 50]]);
    expect(data.JUNGLE?.baselines).toEqual([]);
    // roleProb is shared; the n_eff=2.5 TOP row is gated out, leaving SUPPORT=1.
    expect(data.SUPPORT?.roleProb['412']).toEqual({ SUPPORT: 1 });
    expect(data.SUPPORT?.tags['412']?.damageType).toBe('AP');
    expect(data.SUPPORT?.championIds).toEqual([412, 413]);
  });
});

describe('loadChampionTagsMap', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'draftorb-tags-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads a valid champion-tags.json', () => {
    const path = join(directory, 'champion-tags.json');
    writeFileSync(path, JSON.stringify(TAGS), 'utf8');
    expect(loadChampionTagsMap(path)['412']?.championId).toBe(412);
  });

  it('fails loudly on a missing or invalid tags file (B-047)', () => {
    expect(() => loadChampionTagsMap(join(directory, 'missing.json'))).toThrow(
      /Cannot load champion tags/,
    );
    const bad = join(directory, 'bad.json');
    writeFileSync(bad, '{not json', 'utf8');
    expect(() => loadChampionTagsMap(bad)).toThrow(/Cannot load champion tags/);
  });
});
