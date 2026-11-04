import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DraftScreen } from './DraftScreen.js';

describe('DraftScreen', () => {
  it('renders the draft controls and always-visible overall list', () => {
    const markup = renderToStaticMarkup(createElement(DraftScreen));

    expect(markup).toContain('Best overall');
    expect(markup).toContain('Your team');
    expect(markup).toContain('Enemy team');
    expect(markup).toContain('Search a champion');
  });
});
