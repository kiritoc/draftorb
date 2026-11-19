import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeProfile } from '../profile/test-fixtures';
import type { ProfileLoad } from '../profile/profile-export';
import { RecordBadge } from './RecordBadge';
import { SettingsScreen } from './SettingsScreen';

const game = (win: boolean) => ({ championId: 1, role: 'SUPPORT' as const, win });
const badge = (load: ProfileLoad) =>
  renderToStaticMarkup(createElement(RecordBadge, { load, championId: 1, role: 'SUPPORT' }));

describe('RecordBadge', () => {
  it('shows games and the rounded win rate from 5 games, with a tooltip', () => {
    const games = [
      ...Array.from({ length: 7 }, () => game(true)),
      ...Array.from({ length: 5 }, () => game(false)),
    ];
    const html = badge({ kind: 'loaded', profile: makeProfile(games) });
    expect(html).toContain('12 games · 58%');
    expect(html).toContain(
      'title="KiriToc&#x27;s picks · synced 2026-11-17 · 12 games in the export"',
    );
  });

  it('shows not enough data with singular and plural counts', () => {
    expect(badge({ kind: 'loaded', profile: makeProfile([game(true)]) })).toContain(
      'Not enough data (1 game)',
    );
    expect(badge({ kind: 'loaded', profile: makeProfile([game(true), game(false)]) })).toContain(
      'Not enough data (2 games)',
    );
    expect(badge({ kind: 'loaded', profile: makeProfile([]) })).toContain(
      'Not enough data (0 games)',
    );
  });

  it('shows No data when nothing is loaded', () => {
    expect(badge({ kind: 'none', reason: 'missing' })).toContain('No data');
    expect(badge({ kind: 'invalid', notice: 'x' })).toContain('No data');
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
