/**
 * PoolTransferSection static-render contract (B-081): the transfer status
 * message is rendered next to the repo/JSON actions that produced it, so
 * feedback stays visible while the user is scrolled to the bottom of the
 * pool editor modal.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PoolEditorMessage } from '../pool/pool-editor-state';
import { emptyPool } from '../pool/pool-model';
import { PoolTransferSection } from './PoolTransferSection';

const render = (message: PoolEditorMessage | null): string =>
  renderToStaticMarkup(
    createElement(PoolTransferSection, {
      pool: emptyPool(),
      dirty: false,
      repoFolder: 'C:/repo',
      message,
      onApplyJson: () => true,
      onRepoImport: () => {},
      onRepoExport: () => {},
    }),
  );

describe('PoolTransferSection', () => {
  it('renders nothing when there is no message', () => {
    const markup = render(null);
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
  });

  it('renders an info message as a status next to the repo actions', () => {
    const markup = render({ text: 'Pool exported to the repo file', kind: 'info' });
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Pool exported to the repo file');
    expect(markup.indexOf('Export to repo file')).toBeLessThan(markup.indexOf('role="status"'));
  });

  it('renders an error message as an alert', () => {
    const markup = render({ text: 'Could not save the pool', kind: 'error' });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Could not save the pool');
  });
});
