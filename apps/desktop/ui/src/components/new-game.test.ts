/**
 * "New game" reset contract (BL-055, SPECS §10): the header button shows on
 * every screen, the confirmation dialog follows the pool-editor modal
 * pattern, and a confirmed reset remounts the Pick and Setup screens via a
 * changing React `key` so every per-game field returns to its default while
 * pool, settings, profile and aggregates stay untouched.
 */

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { strings } from '../strings';
import { PickScreen } from '../screens/PickScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { AppShell, type AppShellProps } from './AppShell';
import { NewGameDialog } from './NewGameDialog';

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
  gameResetNonce: 0,
  newGameOpen: false,
  onNewGameOpenChange: () => {},
  onNewGameConfirm: () => {},
};

const render = (overrides: Partial<AppShellProps> = {}): string =>
  renderToStaticMarkup(createElement(AppShell, { ...base, ...overrides }));

/**
 * Depth-first search for the first element whose type is `type`.
 * Walks `props.children` manually: `Children.toArray` would prefix keys
 * (`.$…`) and hide the `key` the screen was mounted with.
 */
function* elements(node: ReactNode): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const child of node) yield* elements(child);
    return;
  }
  if (!isValidElement(node)) return;
  yield node;
  yield* elements((node.props as { children?: ReactNode }).children);
}

function findByType(node: ReactNode, type: unknown): ReactElement | undefined {
  for (const element of elements(node)) {
    if (element.type === type) return element;
  }
  return undefined;
}

describe('New game header button', () => {
  it('is visible in the header on every screen', () => {
    for (const screen of ['pick', 'setup', 'game', 'settings'] as const) {
      const html = render({ screen });
      expect(html).toContain(`>${strings.newGame}</button>`);
    }
  });
});

describe('NewGameDialog', () => {
  const renderDialog = (open: boolean): string =>
    renderToStaticMarkup(
      createElement(NewGameDialog, { open, onCancel: () => {}, onConfirm: () => {} }),
    );

  it('renders nothing while closed', () => {
    expect(renderDialog(false)).toBe('');
  });

  it('asks for confirmation with cancel and confirm actions', () => {
    const markup = renderDialog(true);
    expect(markup).toContain(strings.newGameDialogLabel);
    expect(markup).toContain(strings.newGameConfirmText);
    expect(markup).toContain(`>${strings.newGameCancel}</button>`);
    expect(markup).toContain(`>${strings.newGameConfirm}</button>`);
  });
});

describe('game reset remount', () => {
  it('gives PickScreen a new key on each reset nonce so it remounts', () => {
    const before = AppShell({ ...base, screen: 'pick', gameResetNonce: 0 });
    const after = AppShell({ ...base, screen: 'pick', gameResetNonce: 1 });
    expect(findByType(before, PickScreen)?.key).toBe('pick-0');
    expect(findByType(after, PickScreen)?.key).toBe('pick-1');
  });

  it('gives SetupScreen a new key on each reset nonce so it remounts', () => {
    const before = AppShell({ ...base, screen: 'setup', gameResetNonce: 0 });
    const after = AppShell({ ...base, screen: 'setup', gameResetNonce: 1 });
    expect(findByType(before, SetupScreen)?.key).toBe('setup-0');
    expect(findByType(after, SetupScreen)?.key).toBe('setup-1');
  });

  it('does not remount the Pick screen for an unrelated re-render', () => {
    const first = AppShell({ ...base, screen: 'pick', gameResetNonce: 3 });
    const second = AppShell({ ...base, screen: 'pick', gameResetNonce: 3 });
    expect(findByType(first, PickScreen)?.key).toBe(findByType(second, PickScreen)?.key);
  });
});
