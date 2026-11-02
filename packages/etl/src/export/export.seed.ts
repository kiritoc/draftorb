import type Database from 'better-sqlite3';

type MatchSeed = { patch?: string; platform?: string; matchId?: string };
type RoleProbSeed = {
  championId: number;
  role: string;
  gamesW: number;
  gamesW2: number;
  prob?: number;
};
type WeightedSeed = {
  championId: number;
  myRole: string;
  rankBucket: string;
  gamesW: number;
  gamesW2: number;
  winsW: number;
};
export type BaselineSeed = WeightedSeed & { games: number };
type PairSeed = WeightedSeed & { otherId: number; otherRole: string };
type LaneVsSeed = WeightedSeed & { opp1Id: number; opp2Id: number | null };
type LaneFullSeed = LaneVsSeed & { partnerId: number | null };
export type RuneCtxSeed = Omit<WeightedSeed, 'rankBucket'> & {
  contextKey: string;
  contextLevel: number;
  perksHash: string;
  perksJson: string;
  players: number;
};
export type ItemBuildSeed = Omit<WeightedSeed, 'rankBucket'> & {
  slotIdx: number;
  timeBucket: string;
  stateBucket: string;
  profileKey: string;
  laneKey: string | null;
  itemId: number;
};

interface SeedRows {
  match: MatchSeed;
  roleProb: RoleProbSeed;
  baseline: BaselineSeed;
  pairAlly: PairSeed;
  pairEnemy: PairSeed;
  laneVs: LaneVsSeed;
  laneFull: LaneFullSeed;
  runeCtx: RuneCtxSeed;
  itemBuild: ItemBuildSeed;
}

type SeedArgs = {
  [K in keyof SeedRows]: [kind: K, rows: readonly SeedRows[K][]];
}[keyof SeedRows];

interface TableDefinition<Row> {
  table: string;
  columns: readonly string[];
  toRow(row: Row): unknown[];
}

type TableDefinitions = { [K in keyof SeedRows]: TableDefinition<SeedRows[K]> };
const pairColumns = [
  'my_champion_id',
  'my_role',
  'other_champion_id',
  'other_role',
  'rank_bucket',
  'wins_w',
  'games_w',
  'games_w2',
];
const pairToRow = (row: PairSeed) => [
  row.championId,
  row.myRole,
  row.otherId,
  row.otherRole,
  row.rankBucket,
  row.winsW,
  row.gamesW,
  row.gamesW2,
];

const TABLES = {
  match: {
    table: 'matches',
    columns: [
      'match_id',
      'platform',
      'patch',
      'queue_id',
      'duration',
      'created_at',
      'avg_rank_score',
      'rank_known_count',
    ],
    toRow: (row: MatchSeed) => [
      row.matchId ?? 'm1',
      row.platform ?? 'euw1',
      row.patch ?? '16.21',
      420,
      1800,
      1,
      6.5,
      2,
    ],
  },
  roleProb: {
    table: 'role_prob',
    columns: ['champion_id', 'role', 'games', 'games_w', 'games_w2', 'prob'],
    toRow: (row: RoleProbSeed) => [
      row.championId,
      row.role,
      1,
      row.gamesW,
      row.gamesW2,
      row.prob ?? 0.5,
    ],
  },
  baseline: {
    table: 'baseline',
    columns: ['champion_id', 'my_role', 'rank_bucket', 'wins_w', 'games_w', 'games_w2', 'games'],
    toRow: (row: BaselineSeed) => [
      row.championId,
      row.myRole,
      row.rankBucket,
      row.winsW,
      row.gamesW,
      row.gamesW2,
      row.games,
    ],
  },
  pairAlly: { table: 'pair_ally', columns: pairColumns, toRow: pairToRow },
  pairEnemy: { table: 'pair_enemy', columns: pairColumns, toRow: pairToRow },
  laneVs: {
    table: 'lane_vs',
    columns: [
      'my_champion_id',
      'my_role',
      'opp1_id',
      'opp2_id',
      'rank_bucket',
      'wins_w',
      'games_w',
      'games_w2',
    ],
    toRow: (row: LaneVsSeed) => [
      row.championId,
      row.myRole,
      row.opp1Id,
      row.opp2Id,
      row.rankBucket,
      row.winsW,
      row.gamesW,
      row.gamesW2,
    ],
  },
  laneFull: {
    table: 'lane_full',
    columns: [
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
    toRow: (row: LaneFullSeed) => [
      row.championId,
      row.myRole,
      row.partnerId,
      row.opp1Id,
      row.opp2Id,
      row.rankBucket,
      row.winsW,
      row.gamesW,
      row.gamesW2,
    ],
  },
  runeCtx: {
    table: 'rune_ctx',
    columns: [
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
    toRow: (row: RuneCtxSeed) => [
      row.championId,
      row.myRole,
      'IRON',
      row.contextKey,
      row.contextLevel,
      row.perksHash,
      row.perksJson,
      row.winsW,
      row.gamesW,
      row.gamesW2,
      row.players,
    ],
  },
  itemBuild: {
    table: 'item_build',
    columns: [
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
    toRow: (row: ItemBuildSeed) => [
      row.championId,
      row.myRole,
      row.slotIdx,
      row.timeBucket,
      row.stateBucket,
      row.profileKey,
      row.laneKey ?? '',
      row.itemId,
      row.winsW,
      row.gamesW,
      row.gamesW2,
    ],
  },
} satisfies TableDefinitions;

function insertRows(
  db: Database.Database,
  table: string,
  columns: readonly string[],
  rows: readonly unknown[][],
): void {
  const placeholders = columns.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
  );
  const write = db.transaction(() => {
    for (const row of rows) insert.run(...row);
  });
  write.immediate();
}

function insertTableRows<Row>(
  db: Database.Database,
  table: TableDefinition<Row>,
  rows: readonly Row[],
): void {
  insertRows(
    db,
    table.table,
    table.columns,
    rows.map((row) => table.toRow(row)),
  );
}

export function seed(db: Database.Database, ...args: SeedArgs): void {
  switch (args[0]) {
    case 'match':
      insertTableRows(db, TABLES.match, args[1]);
      return;
    case 'roleProb':
      insertTableRows(db, TABLES.roleProb, args[1]);
      return;
    case 'baseline':
      insertTableRows(db, TABLES.baseline, args[1]);
      return;
    case 'pairAlly':
      insertTableRows(db, TABLES.pairAlly, args[1]);
      return;
    case 'pairEnemy':
      insertTableRows(db, TABLES.pairEnemy, args[1]);
      return;
    case 'laneVs':
      insertTableRows(db, TABLES.laneVs, args[1]);
      return;
    case 'laneFull':
      insertTableRows(db, TABLES.laneFull, args[1]);
      return;
    case 'runeCtx':
      insertTableRows(db, TABLES.runeCtx, args[1]);
      return;
    case 'itemBuild':
      insertTableRows(db, TABLES.itemBuild, args[1]);
  }
}
