import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, type AppShellProps } from './AppShell';

const base: AppShellProps = {
  screen: 'pick',
  onScreenChange: () => {},
  dataStatus: { kind: 'none' },
  dataReadyNonce: 0,
  theme: 'system',
  resolvedTheme: 'light',
  onThemeChange: () => {},
  onToggleTheme: () => {},
  role: 'SUPPORT',
  onRoleChange: () => {},
};

const DISABLED = /\sdisabled=""/;

const render = (overrides: Partial<AppShellProps> = {}): string =>
  renderToStaticMarkup(createElement(AppShell, { ...base, ...overrides }));

/** Opening tag of the first button whose label is `label`. */
function buttonTag(html: string, label: string): string {
  const match = new RegExp(`<button[^>]*>${label}</button>`).exec(html);
  if (!match) throw new Error(`button ${label} not found`);
  return match[0];
}

describe('AppShell', () => {
  const html = render();

  it('shows the unvalidated label and the empty data status', () => {
    expect(html).toContain('Unvalidated model');
    expect(html).toContain('No data loaded yet');
    expect(html).toContain('Patch');
  });

  it('renders the nav with Setup and Game disabled', () => {
    expect(buttonTag(html, 'Pick')).not.toMatch(DISABLED);
    expect(buttonTag(html, 'Setup')).toMatch(DISABLED);
    expect(buttonTag(html, 'Game')).toMatch(DISABLED);
    expect(buttonTag(html, 'Settings')).not.toMatch(DISABLED);
  });

  it('enables only SUPPORT in the role selector', () => {
    expect(buttonTag(html, 'Support')).not.toMatch(DISABLED);
    for (const label of ['Top', 'Jungle', 'ADC', 'Mid']) {
      expect(buttonTag(html, label)).toMatch(DISABLED);
    }
  });

  it('renders the settings screen with the theme choice and a notice', () => {
    const settings = render({
      screen: 'settings',
      notice: 'Settings were reset: the file was unreadable',
    });
    expect(settings).toContain('Follow Windows');
    expect(settings).toContain('Settings were reset');
  });
});
