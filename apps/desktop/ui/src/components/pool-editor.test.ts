/**
 * PoolEditor static-render contract (BL-016b, SPECS §2.1/§19.3): champion x
 * roles checkboxes, per-role entries with counts, JSON backup and the
 * repo-file actions gated on the repo folder.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Champion, PoolConfig } from '@draftorb/shared';
import { setChampionRoles, emptyPool } from '../pool/pool-model';
import { PoolEditor } from './PoolEditor';

const champions: Champion[] = [
  { id: 89, name: 'Leona', icon: 'Leona.png', roles: ['SUPPORT'] },
  { id: 98, name: 'Shen', icon: 'Shen.png', roles: ['TOP'] },
];

const pool: PoolConfig = setChampionRoles(
  setChampionRoles(emptyPool(), 89, ['SUPPORT', 'TOP']).pool,
  98,
  ['TOP', 'JUNGLE'],
).pool;

const render = (overrides: Partial<Parameters<typeof PoolEditor>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(PoolEditor, {
      open: true,
      onClose: () => {},
      pool,
      champions,
      onSave: () => {},
      ...overrides,
    }),
  );

describe('PoolEditor', () => {
  it('renders nothing when closed', () => {
    expect(render({ open: false })).toBe('');
  });

  it('shows the champion x roles editor with all five role checkboxes', () => {
    const markup = render();
    expect(markup).toContain('Champion pool');
    for (const role of ['Top', 'Jungle', 'Mid', 'ADC', 'Support']) {
      expect(markup).toContain(`>${role}<`);
    }
    expect(markup).toContain('Apply roles');
    expect(markup).toContain('Pick a champion');
  });

  it('lists pool entries under their roles with per-role counts', () => {
    const markup = render();
    expect(markup).toContain('Leona');
    expect(markup).toContain('Shen');
    // Leona is in SUPPORT + TOP, Shen in TOP + JUNGLE: TOP holds both.
    expect(markup.match(/2\/40/g)?.length).toBeGreaterThanOrEqual(1);
    expect(markup).toContain('Remove Leona from Support');
    expect(markup).toContain('Remove Shen from Jungle');
  });

  it('shows the repo-file hint when no repo folder is set', () => {
    expect(render()).toContain('Set the repo folder in Settings');
    expect(render()).not.toContain('Import from repo file');
  });

  it('shows repo-file actions when a repo folder is set', () => {
    const markup = render({ repoFolder: 'C:/repo' });
    expect(markup).toContain('Import from repo file');
    expect(markup).toContain('Export to repo file');
    expect(markup).not.toContain('Set the repo folder in Settings');
  });

  it('offers JSON backup import/export', () => {
    const markup = render();
    expect(markup).toContain('JSON backup');
    expect(markup).toContain('Apply JSON');
  });
});
