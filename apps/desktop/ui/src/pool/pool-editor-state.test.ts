/**
 * Pool editor interaction rules (BL-016b): draft checkboxes stay in sync
 * with the working copy, apply-to-empty removes, repo export guard.
 */

import { describe, expect, it } from 'vitest';

import { championPoolRoles, emptyPool, setChampionRoles } from './pool-model';
import {
  canApplyDraft,
  canExportToRepo,
  initPoolEditorState,
  poolEditorReducer as reduce,
} from './pool-editor-state';

const SHEN = 98;
const LEONA = 89;
const saved = setChampionRoles(emptyPool(), SHEN, ['TOP', 'JUNGLE']).pool;

describe('poolEditorReducer', () => {
  it('a removed chip of the selected champion does not come back on apply', () => {
    let s = reduce(initPoolEditorState(saved), { type: 'pickChampion', id: SHEN });
    s = reduce(s, { type: 'remove', championId: SHEN, role: 'JUNGLE' });
    s = reduce(s, { type: 'toggleRole', role: 'SUPPORT' });
    s = reduce(s, { type: 'apply' });
    expect(championPoolRoles(s.working, SHEN)).toEqual(['TOP', 'SUPPORT']);
  });

  it('removing another champion leaves the draft selection alone', () => {
    const pool = setChampionRoles(saved, LEONA, ['SUPPORT']).pool;
    let s = reduce(initPoolEditorState(pool), { type: 'pickChampion', id: SHEN });
    s = reduce(s, { type: 'remove', championId: LEONA, role: 'SUPPORT' });
    expect(s.draftRoles).toEqual(['TOP', 'JUNGLE']);
  });

  it('clear and import reset the draft selection', () => {
    let s = reduce(initPoolEditorState(saved), { type: 'pickChampion', id: SHEN });
    s = reduce(s, { type: 'clear' });
    expect(s.draftChampionId).toBeNull();
    expect(s.draftRoles).toEqual([]);
    s = reduce(reduce(s, { type: 'pickChampion', id: SHEN }), {
      type: 'replace',
      pool: saved,
      message: null,
    });
    expect(s.draftChampionId).toBeNull();
    expect(s.working).toBe(saved);
  });

  it('applying with every role unticked removes the champion', () => {
    let s = reduce(initPoolEditorState(saved), { type: 'pickChampion', id: SHEN });
    s = reduce(reduce(s, { type: 'toggleRole', role: 'TOP' }), {
      type: 'toggleRole',
      role: 'JUNGLE',
    });
    expect(canApplyDraft(s)).toBe(true);
    s = reduce(s, { type: 'apply' });
    expect(championPoolRoles(s.working, SHEN)).toEqual([]);
  });

  it('cannot apply an empty selection for a champion outside the pool', () => {
    const s = reduce(initPoolEditorState(saved), { type: 'pickChampion', id: LEONA });
    expect(canApplyDraft(s)).toBe(false);
  });
});

describe('canExportToRepo', () => {
  it('refuses unsaved edits and allows reverted or saved state', () => {
    const edited = setChampionRoles(saved, LEONA, ['SUPPORT']).pool;
    expect(canExportToRepo(edited, saved)).toBe(false);
    const reverted = setChampionRoles(edited, LEONA, []).pool;
    expect(canExportToRepo(reverted, saved)).toBe(true);
    expect(canExportToRepo(edited, edited)).toBe(true);
  });
});
