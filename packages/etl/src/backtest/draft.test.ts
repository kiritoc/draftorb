import { describe, expect, it } from 'vitest';

import { runBacktestDraft, type DraftRow } from './draft';

const ROLES: readonly import('@draftorb/shared').Role[] = [
  'TOP',
  'JUNGLE',
  'MID',
  'ADC',
  'SUPPORT',
];

/** Build one full 10-player match. Every participant on the winning team has
 *  win = 1, the losers win = 0. `champAt` places `championId` at `role` on
 *  `side` ('blue' = team 100, 'red' = team 200). */
function makeMatch({
  matchId,
  patch,
  blueWins,
  champAt,
}: {
  matchId: string;
  patch: string;
  blueWins: boolean;
  champAt?: { role: import('@draftorb/shared').Role; championId: number; side: 'blue' | 'red' };
}): DraftRow[] {
  const rows: DraftRow[] = [];
  const teamChampions: Record<number, number[]> = { 100: [], 200: [] };
  let placed = false;
  for (const teamId of [100, 200]) {
    let index = 0;
    for (const role of ROLES) {
      let championId = 10 + teamId + index; // distinct filler champion
      if (
        champAt &&
        !placed &&
        champAt.role === role &&
        ((champAt.side === 'blue' && teamId === 100) || (champAt.side === 'red' && teamId === 200))
      ) {
        championId = champAt.championId;
        placed = true;
      }
      teamChampions[teamId]!.push(championId);
      rows.push({
        matchId,
        patch,
        teamId,
        championId,
        role,
        win: blueWins === (teamId === 100) ? 1 : 0,
        rankScore: 2500,
      });
      index += 1;
    }
  }
  return rows;
}

describe('runBacktestDraft', () => {
  it('returns insufficient data for an empty database', () => {
    const report = runBacktestDraft([]);
    expect(report.insufficientData).toBe(true);
    expect(report.holdoutPatch).toBeNull();
    expect(report.logLoss).toBeNull();
  });

  it('excludes the holdout patch from the training aggregates', () => {
    const rows: DraftRow[] = [];
    // 8 training games on patch 16.20
    for (let i = 0; i < 8; i += 1) {
      rows.push(...makeMatch({ matchId: `t${i}`, patch: '16.20', blueWins: i % 2 === 0 }));
    }
    // 4 holdout games on patch 16.21
    for (let i = 0; i < 4; i += 1) {
      rows.push(...makeMatch({ matchId: `h${i}`, patch: '16.21', blueWins: true }));
    }

    const report = runBacktestDraft(rows);
    expect(report.holdoutPatch).toBe('16.21');
    expect(report.trainingPatches).toEqual(['16.20']);
    expect(report.trainingGames).toBe(80);
    expect(report.holdoutGames).toBe(40);
    expect(report.insufficientData).toBe(false);
  });

  it('detects a planted matchup effect for TOP and SUPPORT', () => {
    const rows: DraftRow[] = [];

    // Training on 16.20: champion 100 is TOP and always wins when on blue,
    // always loses when on red -> strong planted effect.
    for (let i = 0; i < 10; i += 1) {
      rows.push(
        ...makeMatch({
          matchId: `t-top-blue-${i}`,
          patch: '16.20',
          blueWins: true,
          champAt: { role: 'TOP', championId: 100, side: 'blue' },
        }),
      );
      rows.push(
        ...makeMatch({
          matchId: `t-top-red-${i}`,
          patch: '16.20',
          blueWins: false,
          champAt: { role: 'TOP', championId: 100, side: 'red' },
        }),
      );
    }
    // Training: champion 200 is SUPPORT and wins 75% of the time.
    for (let i = 0; i < 8; i += 1) {
      rows.push(
        ...makeMatch({
          matchId: `t-supp-blue-${i}`,
          patch: '16.20',
          blueWins: true,
          champAt: { role: 'SUPPORT', championId: 200, side: 'blue' },
        }),
      );
    }
    for (let i = 0; i < 2; i += 1) {
      rows.push(
        ...makeMatch({
          matchId: `t-supp-red-${i}`,
          patch: '16.20',
          blueWins: false,
          champAt: { role: 'SUPPORT', championId: 200, side: 'red' },
        }),
      );
    }

    // Holdout on 16.21: the same pattern holds.
    for (let i = 0; i < 6; i += 1) {
      rows.push(
        ...makeMatch({
          matchId: `h-top-blue-${i}`,
          patch: '16.21',
          blueWins: true,
          champAt: { role: 'TOP', championId: 100, side: 'blue' },
        }),
      );
      rows.push(
        ...makeMatch({
          matchId: `h-top-red-${i}`,
          patch: '16.21',
          blueWins: false,
          champAt: { role: 'TOP', championId: 100, side: 'red' },
        }),
      );
      rows.push(
        ...makeMatch({
          matchId: `h-supp-blue-${i}`,
          patch: '16.21',
          blueWins: true,
          champAt: { role: 'SUPPORT', championId: 200, side: 'blue' },
        }),
      );
    }

    const report = runBacktestDraft(rows);
    expect(report.holdoutPatch).toBe('16.21');
    expect(report.insufficientData).toBe(false);
    expect(report.perRole.TOP.effectDetected).toBe(true);
    expect(report.perRole.SUPPORT.effectDetected).toBe(true);
    expect(report.perRole.TOP.effectSize).not.toBeNull();
    expect(report.perRole.SUPPORT.effectSize).not.toBeNull();
    expect(report.perRole.TOP.effectSize as number).toBeGreaterThan(0);
    expect(report.perRole.SUPPORT.effectSize as number).toBeGreaterThan(0);
    expect(report.logLoss).toBeLessThan(report.baselineLogLoss!);
  });
});
