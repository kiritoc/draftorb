import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion } from '@draftorb/shared';
import type { EnemyRoleView } from '../pick/enemy-roles';
import { DraftSlot, type DraftSlotState } from './DraftSlot';

const champion: Champion = { id: 200, name: 'Ashe', icon: 'Ashe.png', roles: ['ADC'] };

function render(slot: DraftSlotState, roleView?: EnemyRoleView | null) {
  return renderToStaticMarkup(
    createElement(DraftSlot, {
      label: 'Enemy 1',
      slot,
      onChange: () => {},
      champions: [champion],
      roleView,
    }),
  );
}

describe('DraftSlot enemy role view', () => {
  it('shows the inferred role with confidence and keeps the role select labelled', () => {
    const html = render(
      { championId: 200 },
      { championId: 200, source: 'inferred', role: 'ADC', confidence: 0.7 },
    );

    expect(html).toContain('Inferred ADC · 70%');
    expect(html).toContain('aria-label="Enemy 1 role"');
    expect(html).toContain('<select');
    expect(html).not.toContain('disabled=""');
  });

  it('shows a manual override without an inferred-confidence badge', () => {
    const html = render(
      { championId: 200, role: 'SUPPORT' },
      { championId: 200, source: 'manual', role: 'SUPPORT', confidence: 1 },
    );

    expect(html).toContain('Manual Support');
    expect(html).not.toContain('Inferred');
    expect(html).toContain('aria-label="Enemy 1 role"');
  });

  it('shows an unresolved state when the engine cannot infer a role', () => {
    const html = render(
      { championId: 200 },
      { championId: 200, source: 'unresolved', role: null, confidence: null },
    );

    expect(html).toContain('No role inferred');
    expect(html).not.toContain('Inferred ADC');
  });
});
