/**
 * Draft handoff pick -> setup (BL-058): the setup screen reuses the pick
 * screen's locked champion and draft slots without re-entry, and the
 * resulting `DraftInput` stays backward compatible when no handoff exists.
 */

import { describe, expect, it } from 'vitest';

import type { DraftInput } from '@draftorb/shared';

import { setupDraftInput, type DraftHandoff } from './draft-handoff';

const pickDraft: DraftInput = {
  userRank: 'DIAMOND',
  userRole: 'SUPPORT',
  allies: [{ championId: 1, role: 'TOP' }, { championId: 2 }],
  enemies: [{ championId: 3, role: 'JUNGLE' }],
  blindPick: false,
  pool: [7, 8],
  bans: [9],
};

const handoff: DraftHandoff = { championId: 42, draft: pickDraft };

describe('setupDraftInput', () => {
  it('carries the pick screen allies, enemies, bans and pool into the setup draft', () => {
    const draft = setupDraftInput(handoff, 'SUPPORT', 'GOLD');
    expect(draft.allies).toEqual(pickDraft.allies);
    expect(draft.enemies).toEqual(pickDraft.enemies);
    expect(draft.bans).toEqual([9]);
    expect(draft.pool).toEqual([7, 8]);
  });

  it('keeps the setup screen role and rank authoritative', () => {
    const draft = setupDraftInput(handoff, 'TOP', 'IRON');
    expect(draft.userRole).toBe('TOP');
    expect(draft.userRank).toBe('IRON');
    expect(draft.blindPick).toBe(false);
  });

  it('returns empty slots without a handoff (pre-BL-058 behavior)', () => {
    const draft = setupDraftInput(undefined, 'SUPPORT', 'DIAMOND');
    expect(draft).toEqual({
      userRank: 'DIAMOND',
      userRole: 'SUPPORT',
      allies: [],
      enemies: [],
      blindPick: false,
    });
  });

  it('omits bans/pool keys when the handoff draft has none', () => {
    const minimal: DraftInput = {
      userRank: 'DIAMOND',
      userRole: 'SUPPORT',
      allies: [],
      enemies: [],
      blindPick: false,
    };
    const draft = setupDraftInput({ championId: null, draft: minimal }, 'MID', 'MASTER');
    expect('bans' in draft).toBe(false);
    expect('pool' in draft).toBe(false);
    expect(draft.userRole).toBe('MID');
  });
});
