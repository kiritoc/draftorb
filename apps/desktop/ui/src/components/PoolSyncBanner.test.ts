import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PoolSyncBanner } from './PoolSyncBanner';
import { SettingsScreen } from './SettingsScreen';

const render = (status: Parameters<typeof PoolSyncBanner>[0]['status']) =>
  renderToStaticMarkup(createElement(PoolSyncBanner, { status }));

describe('PoolSyncBanner', () => {
  it('warns when the pools differ', () => {
    expect(render({ kind: 'differs' })).toContain('differs from data/pool.config.json');
  });

  it('shows a small notice for an invalid file', () => {
    expect(render({ kind: 'invalid', notice: 'The repo pool file is invalid' })).toContain(
      'The repo pool file is invalid',
    );
  });

  it.each([{ kind: 'inSync' }, { kind: 'noFolder' }, { kind: 'missingFile' }] as const)(
    'renders nothing for %o',
    (status) => {
      expect(render(status)).toBe('');
    },
  );
});

describe('SettingsScreen repo folder field', () => {
  const props = { theme: 'system', onThemeChange: () => {} } as const;

  it('renders the labeled field with the current value, buttons and help', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsScreen, { ...props, repoFolder: 'C:\\dev\\draftorb' }),
    );
    expect(html).toContain('Repo folder');
    expect(html).toContain('value="C:\\dev\\draftorb"');
    expect(html).toContain('>Save<');
    expect(html).toContain('>Clear<');
    expect(html).toContain('data/pool.config.json');
  });

  it('shows the desktop-only message in a plain browser', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsScreen, { ...props, repoFolderAvailable: false }),
    );
    expect(html).toContain('Available in the desktop program only');
    expect(html).not.toContain('<input id="repo-folder"');
  });
});
