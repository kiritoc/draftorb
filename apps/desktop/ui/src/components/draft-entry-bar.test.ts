import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion } from '@draftorb/shared';
import { DraftEntryBar, type EntryTargetInfo } from './DraftEntryBar';

const champions: Champion[] = [
  { id: 1, name: 'Ahri', icon: 'Ahri.png', roles: ['MID'] },
  { id: 2, name: 'Blitzcrank', icon: 'Blitzcrank.png', roles: ['SUPPORT'] },
];

const targets: EntryTargetInfo[] = [
  { key: 'user', label: 'You', championName: null },
  { key: 'ally-0', label: 'Ally 1', championName: 'Ahri' },
  { key: 'ally-1', label: 'Ally 2', championName: null },
  { key: 'ally-2', label: 'Ally 3', championName: null },
  { key: 'ally-3', label: 'Ally 4', championName: null },
  { key: 'enemy-0', label: 'Enemy 1', championName: 'Blitzcrank' },
  { key: 'enemy-1', label: 'Enemy 2', championName: null },
  { key: 'enemy-2', label: 'Enemy 3', championName: null },
  { key: 'enemy-3', label: 'Enemy 4', championName: null },
  { key: 'enemy-4', label: 'Enemy 5', championName: null },
];

function render(overrides: Partial<Parameters<typeof DraftEntryBar>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(DraftEntryBar, {
      champions,
      targets,
      activeIndex: 0,
      onActiveIndex: () => {},
      bans: [],
      excludedIds: new Set<number>(),
      roleEditable: false,
      onPick: () => {},
      onSetRole: () => {},
      onAddBan: () => {},
      onRemoveBan: () => {},
      ...overrides,
    }),
  );
}

describe('DraftEntryBar', () => {
  it('renders the search input and one chip per pick target plus the ban target', () => {
    const html = render();

    expect(html).toContain('role="combobox"');
    expect(html).toContain('>You<');
    expect(html).toContain('>Ally 1<');
    expect(html).toContain('>Enemy 5<');
    expect(html).toContain('Ban');
    expect(html).toContain('Ahri');
    expect(html).toContain('Blitzcrank');
  });

  it('marks the active target', () => {
    const html = render({ activeIndex: 5 });

    expect(html).toContain('aria-pressed="true"');
  });

  it('shows role chips only when the active slot accepts a role override', () => {
    expect(render({ roleEditable: false })).not.toContain('Auto (infer)');
    const html = render({ roleEditable: true, activeRole: 'TOP' });
    expect(html).toContain('Auto (infer)');
    expect(html).toContain('>Top<');
    expect(html).toContain('aria-pressed="true"');
  });

  it('lists bans with a remove control', () => {
    const html = render({ bans: [2], activeIndex: 10 });

    expect(html).toContain('Blitzcrank');
    expect(html).toContain('aria-label="Remove ban Blitzcrank"');
  });
});
