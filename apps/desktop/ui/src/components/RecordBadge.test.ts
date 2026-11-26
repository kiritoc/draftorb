import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { indexBaselines } from '@draftorb/engine';
import type { BaselineTable } from '@draftorb/shared';
import { makeProfile } from '../profile/test-fixtures';
import type { ProfileLoad } from '../profile/profile-export';
import { RecordBadge } from './RecordBadge';
import { SettingsScreen } from './SettingsScreen';

const game = (win: boolean, role: 'SUPPORT' | 'TOP' = 'SUPPORT') => ({
  championId: 1,
  role,
  win,
});
const badge = (load: ProfileLoad, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(RecordBadge, { load, championId: 1, role: 'SUPPORT', ...extra }),
  );

// n_eff = 250 -> passes the baseline gate; p0 = (150 + 10) / (250 + 20) ≈ 59%.
const baselineTable: BaselineTable = [[1, 'DIAMOND', 60, 100, 40, 120]];
const baselineIndex = indexBaselines(baselineTable, 'DIAMOND');

describe('RecordBadge', () => {
  it('shows the champion average, all-roles and role win rates with the tooltip', () => {
    const games = [
      ...Array.from({ length: 7 }, () => game(true)),
      ...Array.from({ length: 5 }, () => game(false)),
      game(true, 'TOP'),
    ];
    const html = badge(
      { kind: 'loaded', profile: makeProfile(games) },
      { baselineIndex, rankBucket: 'DIAMOND' },
    );
    expect(html).toContain('Diamond avg 59% · n≈250');
    // 13 games overall, 8 wins -> 62%; 12 SUPPORT games, 7 wins -> 58%.
    expect(html).toContain('You · all roles: 13 games · 62%');
    expect(html).toContain('You · Support: 12 games · 58%');
    expect(html).toContain(
      'title="KiriToc&#x27;s picks · synced 2026-11-17 · 13 games in the export"',
    );
  });

  it('shows not enough data with singular and plural counts on both scopes', () => {
    const html = badge({
      kind: 'loaded',
      profile: makeProfile([game(true), game(false, 'TOP')]),
    });
    expect(html).toContain('You · all roles: not enough data (2 games)');
    expect(html).toContain('You · Support: not enough data (1 game)');
  });

  it('shows No data for the personal rows when nothing is loaded', () => {
    expect(badge({ kind: 'none', reason: 'missing' })).toContain('No data');
    expect(badge({ kind: 'invalid', notice: 'x' })).toContain('No data');
  });

  it('shows the champion average row only when a baseline index is provided', () => {
    const load: ProfileLoad = { kind: 'loaded', profile: makeProfile([]) };
    expect(badge(load, { baselineIndex, rankBucket: 'DIAMOND' })).toContain('Diamond avg 59%');
    const noBaseline = badge(load);
    expect(noBaseline).not.toContain('avg');
    expect(noBaseline).not.toContain('n≈');
  });

  it('shows not enough data for the average when the baseline fails the gate', () => {
    const thin: BaselineTable = [[1, 'DIAMOND', 5, 10, 10, 12]];
    const html = badge(
      { kind: 'loaded', profile: makeProfile([]) },
      { baselineIndex: indexBaselines(thin, 'DIAMOND'), rankBucket: 'DIAMOND' },
    );
    expect(html).toContain('Diamond avg: not enough data');
  });
});

describe('Settings profile status line', () => {
  const props = { theme: 'system', onThemeChange: () => {} } as const;
  const render = (profileStatus: string) =>
    renderToStaticMarkup(createElement(SettingsScreen, { ...props, profileStatus }));

  it('shows the loaded and missing statuses', () => {
    expect(render("KiriToc's picks · 3 games · synced 2026-11-17")).toContain('synced 2026-11-17');
    expect(
      render('No profile export found in data/public/profiles/ (run pnpm etl pull)'),
    ).toContain('Personal record');
  });
});
