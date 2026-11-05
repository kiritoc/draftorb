import { describe, expect, it } from 'vitest';

import type { RecommendData, Role } from '@draftorb/shared';

import { runBacktestDraft, type BacktestEngineData, type DraftRow } from './draft';

const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

/** Champion -> actual role for every champion the fixtures use. Match
 *  fillers are `1000 + teamId + roleIndex` (blue team 100 -> 110x, red 200 ->
 *  120x). */
const CHAMP_ROLE: Record<number, Role> = {
  100: 'TOP',
  101: 'TOP',
  300: 'TOP',
  1100: 'TOP',
  1200: 'TOP',
  200: 'SUPPORT',
  201: 'SUPPORT',
  1104: 'SUPPORT',
  1204: 'SUPPORT',
  1101: 'JUNGLE',
  1201: 'JUNGLE',
  1102: 'MID',
  1202: 'MID',
  1103: 'ADC',
  1203: 'ADC',
};

const ALL_CHAMPIONS = Object.keys(CHAMP_ROLE).map(Number);

/** Champions with a strong DIAMOND baseline per role (30/50 -> n_eff 25000).
 *  Champion 300 deliberately has no baseline row. */
const BASELINE_CHAMPS: Record<Role, number[]> = {
  TOP: [100, 101, 1100, 1200],
  JUNGLE: [],
  MID: [],
  ADC: [],
  SUPPORT: [200, 201, 1104, 1204],
};

/** One full 10-player match. `blue`/`red` map each role to a champion id;
 *  defaults to distinct filler champions. `win` is 1 for the winning team. */
function makeMatch({
  matchId,
  patch,
  blueWins,
  blue,
  red,
}: {
  matchId: string;
  patch: string;
  blueWins: boolean;
  blue?: Partial<Record<Role, number>>;
  red?: Partial<Record<Role, number>>;
}): DraftRow[] {
  const rows: DraftRow[] = [];
  for (const [teamId, side, wins] of [
    [100, blue, blueWins],
    [200, red, !blueWins],
  ] as const) {
    for (const role of ROLES) {
      const override = side?.[role];
      rows.push({
        matchId,
        patch,
        teamId,
        championId: override ?? 1000 + teamId + ROLES.indexOf(role),
        role,
        win: wins ? 1 : 0,
        rankScore: 6.5, // persisted D-016 scale: DIAMOND
      });
    }
  }
  return rows;
}

/** Minimal per-role `RecommendData` in the exported tuple format: baselines
 *  only for `role`'s champions (matching `roles/<ROLE>/baseline.json`). */
function makeRoleData(role: Role, enemyPairs: RecommendData['enemyPairs'] = []): RecommendData {
  const roleProb: Record<string, Partial<Record<Role, number>>> = {};
  for (const c of ALL_CHAMPIONS) roleProb[String(c)] = { [CHAMP_ROLE[c] ?? 'TOP']: 1 };
  return {
    baselines: BASELINE_CHAMPS[role].map(
      (c) => [c, 'DIAMOND', 30, 50, 0.1, 50] as [number, 'DIAMOND', number, number, number, number],
    ),
    allyPairs: [],
    enemyPairs,
    laneVs: [],
    laneFull: [],
    roleProb: roleProb as RecommendData['roleProb'],
    tags: {},
    championIds: ALL_CHAMPIONS,
  };
}

/** Engine data covering TOP and SUPPORT only; other roles are skipped. */
function topSupportData(extra?: {
  topEnemyPairs?: RecommendData['enemyPairs'];
}): BacktestEngineData['dataByRole'] {
  return {
    TOP: makeRoleData('TOP', extra?.topEnemyPairs),
    SUPPORT: makeRoleData('SUPPORT'),
  };
}

const ENGINE: BacktestEngineData = { dataByRole: topSupportData() };

describe('runBacktestDraft (engine evaluation, B-053)', () => {
  it('returns insufficient data for an empty database', () => {
    const report = runBacktestDraft([], ENGINE);
    expect(report.insufficientData).toBe(true);
    expect(report.holdoutPatch).toBeNull();
    expect(report.logLoss).toBeNull();
  });

  it('returns insufficient data when no engine data is provided', () => {
    const rows = [
      ...makeMatch({ matchId: 'h1', patch: '16.21', blueWins: true }),
      ...makeMatch({ matchId: 't1', patch: '16.20', blueWins: false }),
    ];
    const report = runBacktestDraft(rows, { dataByRole: {} });
    expect(report.insufficientData).toBe(true);
    expect(report.logLoss).toBeNull();
  });

  it('excludes the holdout patch from the training aggregates', () => {
    const rows: DraftRow[] = [];
    for (let i = 0; i < 8; i += 1) {
      rows.push(...makeMatch({ matchId: `t${i}`, patch: '16.20', blueWins: i % 2 === 0 }));
    }
    for (let i = 0; i < 4; i += 1) {
      rows.push(...makeMatch({ matchId: `h${i}`, patch: '16.21', blueWins: true }));
    }

    const report = runBacktestDraft(rows, ENGINE);
    expect(report.holdoutPatch).toBe('16.21');
    expect(report.trainingPatches).toEqual(['16.20']);
    expect(report.trainingGames).toBe(8);
    expect(report.holdoutGames).toBe(4);
    expect(report.insufficientData).toBe(false);
    expect(report.validationStatus).toBe('unvalidated');
  });

  it('counts matches, not participant rows, for the minimum training window', () => {
    const report = runBacktestDraft(
      [
        ...makeMatch({ matchId: 'train', patch: '16.20', blueWins: true }),
        ...makeMatch({ matchId: 'holdout', patch: '16.21', blueWins: false }),
      ],
      ENGINE,
    );

    expect(report.insufficientData).toBe(true);
    expect(report.trainingGames).toBe(1);
    expect(report.holdoutGames).toBe(1);
  });

  it('evaluates each holdout player through the deployed recommend engine', () => {
    const rows: DraftRow[] = [];
    for (let i = 0; i < 6; i += 1) {
      rows.push(...makeMatch({ matchId: `t${i}`, patch: '16.20', blueWins: i % 2 === 0 }));
      rows.push(
        ...makeMatch({
          matchId: `h${i}`,
          patch: '16.21',
          blueWins: true,
          blue: { TOP: 100, SUPPORT: 200 },
          red: { TOP: 101, SUPPORT: 201 },
        }),
      );
    }

    const report = runBacktestDraft(rows, ENGINE);
    expect(report.insufficientData).toBe(false);
    // 6 holdout matches x 2 sides x 2 evaluated roles (TOP + SUPPORT) = 24.
    expect(report.predictions).toBe(24);
    expect(report.unscored).toBe(0);
    expect(report.perRole.TOP.predictions).toBe(12);
    expect(report.perRole.TOP.unscored).toBe(0);
    expect(report.perRole.SUPPORT.predictions).toBe(12);
    expect(report.perRole.JUNGLE.predictions).toBe(0);
    if (report.logLoss === null || report.baselineLogLoss === null) {
      throw new Error('Expected finite holdout and baseline log-loss values.');
    }
    expect(report.logLoss).toBeTypeOf('number');
    expect(report.brier).toBeTypeOf('number');
  });

  it('lets matchup layers move the engine prediction away from the champion baseline', () => {
    // Champion 100 (TOP) gets a strong positive enemy-pair term against the
    // actual red TOP (101): the engine score must exceed the 0.6 baseline, so
    // on wins the engine log-loss beats the champion-baseline log-loss. A
    // per-champion win-rate model cannot produce this pairing.
    const enemyPairs: RecommendData['enemyPairs'] = [[100, 101, 'TOP', 'DIAMOND', 45, 50, 0.1]];
    const rows: DraftRow[] = [];
    for (let i = 0; i < 6; i += 1) {
      rows.push(...makeMatch({ matchId: `t${i}`, patch: '16.20', blueWins: i % 2 === 0 }));
      rows.push(
        ...makeMatch({
          matchId: `h${i}`,
          patch: '16.21',
          blueWins: true,
          blue: { TOP: 100 },
          red: { TOP: 101 },
        }),
      );
    }

    const report = runBacktestDraft(rows, {
      dataByRole: topSupportData({ topEnemyPairs: enemyPairs }),
    });
    expect(report.insufficientData).toBe(false);
    expect(report.predictions).toBe(24);
    if (report.logLoss === null || report.baselineLogLoss === null) {
      throw new Error('Expected finite holdout and baseline log-loss values.');
    }
    expect(report.logLoss).toBeLessThan(report.baselineLogLoss);
  });

  it('falls back to the champion baseline when the engine cannot score a pick', () => {
    // Champion 300 has roleProb but no baseline row -> insufficientData in the
    // engine -> unscored prediction using the 0.5 baseline prior.
    const rows: DraftRow[] = [];
    for (let i = 0; i < 6; i += 1) {
      rows.push(...makeMatch({ matchId: `t${i}`, patch: '16.20', blueWins: i % 2 === 0 }));
      rows.push(
        ...makeMatch({
          matchId: `h${i}`,
          patch: '16.21',
          blueWins: true,
          blue: { TOP: 300 },
        }),
      );
    }

    const report = runBacktestDraft(rows, ENGINE);
    expect(report.insufficientData).toBe(false);
    // Blue TOP player unscored (6); every other evaluated pick is scored.
    expect(report.unscored).toBe(6);
    expect(report.predictions).toBe(24);
    expect(report.perRole.TOP.unscored).toBe(6);
  });
});
