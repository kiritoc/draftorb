/**
 * @draftorb/etl — Seeding helpers for export tests.
 *
 * All seeders delegate to the generic `insertRows` to avoid the six near-identical
 * `seed*` helpers that lived in the old `export.test.ts`.
 */

import type Database from 'better-sqlite3';

export function insertRows(
  db: Database.Database,
  table: string,
  columns: string[],
  rows: unknown[][],
): void {
  const placeholders = columns.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
  );
  const write = db.transaction(() => {
    for (const row of rows) {
      insert.run(...row);
    }
  });
  write.immediate();
}

export function seedMatch(
  db: Database.Database,
  patch = '16.21',
  platform = 'euw1',
  matchId = 'm1',
): void {
  insertRows(
    db,
    'matches',
    [
      'match_id',
      'platform',
      'patch',
      'queue_id',
      'duration',
      'created_at',
      'avg_rank_score',
      'rank_known_count',
    ],
    [[matchId, platform, patch, 420, 1800, 1, 6.5, 2]],
  );
}

export function seedRoleProb(
  db: Database.Database,
  rows: readonly {
    championId: number;
    role: string;
    gamesW: number;
    gamesW2: number;
    prob?: number;
  }[],
): void {
  insertRows(
    db,
    'role_prob',
    ['champion_id', 'role', 'games', 'games_w', 'games_w2', 'prob'],
    rows.map((r) => [r.championId, r.role, 1, r.gamesW, r.gamesW2, r.prob ?? 0.5]),
  );
}

export function seedBaseline(
  db: Database.Database,
  rows: readonly {
    championId: number;
    myRole: string;
    rankBucket: string;
    gamesW: number;
    gamesW2: number;
    winsW: number;
    games: number;
  }[],
): void {
  insertRows(
    db,
    'baseline',
    ['champion_id', 'my_role', 'rank_bucket', 'wins_w', 'games_w', 'games_w2', 'games'],
    rows.map((r) => [r.championId, r.myRole, r.rankBucket, r.winsW, r.gamesW, r.gamesW2, r.games]),
  );
}

export function seedPair(
  db: Database.Database,
  table: 'pair_ally' | 'pair_enemy',
  rows: readonly {
    championId: number;
    myRole: string;
    otherId: number;
    otherRole: string;
    rankBucket: string;
    gamesW: number;
    gamesW2: number;
    winsW: number;
  }[],
): void {
  insertRows(
    db,
    table,
    [
      'my_champion_id',
      'my_role',
      'other_champion_id',
      'other_role',
      'rank_bucket',
      'wins_w',
      'games_w',
      'games_w2',
    ],
    rows.map((r) => [
      r.championId,
      r.myRole,
      r.otherId,
      r.otherRole,
      r.rankBucket,
      r.winsW,
      r.gamesW,
      r.gamesW2,
    ]),
  );
}

export function seedLaneVs(
  db: Database.Database,
  rows: readonly {
    championId: number;
    myRole: string;
    opp1Id: number;
    opp2Id: number | null;
    rankBucket: string;
    gamesW: number;
    gamesW2: number;
    winsW: number;
  }[],
): void {
  insertRows(
    db,
    'lane_vs',
    [
      'my_champion_id',
      'my_role',
      'opp1_id',
      'opp2_id',
      'rank_bucket',
      'wins_w',
      'games_w',
      'games_w2',
    ],
    rows.map((r) => [
      r.championId,
      r.myRole,
      r.opp1Id,
      r.opp2Id,
      r.rankBucket,
      r.winsW,
      r.gamesW,
      r.gamesW2,
    ]),
  );
}

export function seedLaneFull(
  db: Database.Database,
  rows: readonly {
    championId: number;
    myRole: string;
    partnerId: number | null;
    opp1Id: number;
    opp2Id: number | null;
    rankBucket: string;
    gamesW: number;
    gamesW2: number;
    winsW: number;
  }[],
): void {
  insertRows(
    db,
    'lane_full',
    [
      'my_champion_id',
      'my_role',
      'partner_id',
      'opp1_id',
      'opp2_id',
      'rank_bucket',
      'wins_w',
      'games_w',
      'games_w2',
    ],
    rows.map((r) => [
      r.championId,
      r.myRole,
      r.partnerId,
      r.opp1Id,
      r.opp2Id,
      r.rankBucket,
      r.winsW,
      r.gamesW,
      r.gamesW2,
    ]),
  );
}

export function seedRuneCtx(
  db: Database.Database,
  rows: readonly {
    championId: number;
    myRole: string;
    contextKey: string;
    contextLevel: number;
    perksHash: string;
    perksJson: string;
    gamesW: number;
    gamesW2: number;
    winsW: number;
    players: number;
  }[],
): void {
  insertRows(
    db,
    'rune_ctx',
    [
      'champion_id',
      'my_role',
      'rank_bucket',
      'context_key',
      'context_level',
      'perks_hash',
      'perks_json',
      'wins_w',
      'games_w',
      'games_w2',
      'players',
    ],
    rows.map((r) => [
      r.championId,
      r.myRole,
      'IRON',
      r.contextKey,
      r.contextLevel,
      r.perksHash,
      r.perksJson,
      r.winsW,
      r.gamesW,
      r.gamesW2,
      r.players,
    ]),
  );
}

export function seedItemBuild(
  db: Database.Database,
  rows: readonly {
    championId: number;
    myRole: string;
    slotIdx: number;
    timeBucket: string;
    stateBucket: string;
    profileKey: string;
    laneKey: string | null;
    itemId: number;
    gamesW: number;
    gamesW2: number;
    winsW: number;
  }[],
): void {
  insertRows(
    db,
    'item_build',
    [
      'champion_id',
      'my_role',
      'slot_idx',
      'time_bucket',
      'state_bucket',
      'profile_key',
      'lane_key',
      'item_id',
      'wins_w',
      'games_w',
      'games_w2',
    ],
    rows.map((r) => [
      r.championId,
      r.myRole,
      r.slotIdx,
      r.timeBucket,
      r.stateBucket,
      r.profileKey,
      r.laneKey,
      r.itemId,
      r.winsW,
      r.gamesW,
      r.gamesW2,
    ]),
  );
}

export const validPerksJson = JSON.stringify({
  statPerks: { offense: 5008, defense: 5005, flex: 5008 },
  styles: [
    { style: 8400, selections: [{ perk: 8439 }, { perk: 8453 }, { perk: 8465 }, { perk: 8473 }] },
    { style: 8100, selections: [{ perk: 9111 }, { perk: 9104 }] },
  ],
});
