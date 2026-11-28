import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Header } from './components/Header';
import { describeDataStatus } from './data-status';

describe('describeDataStatus', () => {
  it('shows both labels for a verified mapping', () => {
    expect(describeDataStatus({ kind: 'loaded', patch: '16.22', generatedAt: 'today' })).toEqual({
      patch: 'Patch 26.22 · data 16.22',
      freshness: 'Data generated today',
    });
  });

  it('says the public name is unknown for an unmapped major', () => {
    const { patch } = describeDataStatus({ kind: 'loaded', patch: '17.3', generatedAt: 'today' });
    expect(patch).toBe('Patch 17.3 (data label; public name unknown)');
  });

  it('keeps the empty state', () => {
    expect(describeDataStatus({ kind: 'none' })).toEqual({
      patch: 'Patch —',
      freshness: 'No data loaded yet',
    });
  });
});

describe('Header patch display', () => {
  it('renders both labels when loaded with a known mapping', () => {
    const html = renderToStaticMarkup(
      createElement(Header, {
        dataStatus: { kind: 'loaded', patch: '16.22', generatedAt: '2026-11-17' },
        resolvedTheme: 'light',
        onToggleTheme: () => {},
        onNewGame: () => {},
      }),
    );
    expect(html).toContain('Patch 26.22 · data 16.22');
  });
});
