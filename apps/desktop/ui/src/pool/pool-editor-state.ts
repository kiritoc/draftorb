/**
 * Pool editor state machine (BL-016b, SPECS §2.1/§19.3). Pure so the
 * interaction rules (draft checkboxes stay in sync with the working copy,
 * apply-to-empty removes a champion, repo export guard) are unit-tested
 * without a DOM.
 */

import {
  POOL_CONFIG_MAX_PER_ROLE,
  type ChampionId,
  type PoolConfig,
  type Role,
} from '@draftorb/shared';
import { strings } from '../strings';
import { championPoolRoles, emptyPool, serializePoolConfig, setChampionRoles } from './pool-model';

/** Where a feedback line renders, next to the action that produced it (B-081). */
export type PoolEditorMessageScope = 'form' | 'transfer' | 'footer';

export interface PoolEditorMessage {
  text: string;
  kind: 'info' | 'error';
  scope: PoolEditorMessageScope;
}

/** Working copy plus the pending champion x roles selection. */
export interface PoolEditorState {
  working: PoolConfig;
  draftChampionId: ChampionId | null;
  draftRoles: readonly Role[];
  message: PoolEditorMessage | null;
}

/** Every interaction the pool editor supports. */
export type PoolEditorAction =
  | { type: 'pickChampion'; id: ChampionId | null }
  | { type: 'toggleRole'; role: Role }
  | { type: 'apply' }
  | { type: 'remove'; championId: ChampionId; role: Role }
  | { type: 'replace'; pool: PoolConfig; message: PoolEditorMessage | null }
  | { type: 'clear' }
  | { type: 'message'; message: PoolEditorMessage | null };

/** Fresh editor session seeded from the stored pool. */
export function initPoolEditorState(pool: PoolConfig): PoolEditorState {
  return { working: pool, draftChampionId: null, draftRoles: [], message: null };
}

/** Routes the single message slot to the section that renders it (B-081). */
export function poolMessageSlots(message: PoolEditorMessage | null): {
  form: PoolEditorMessage | null;
  transfer: PoolEditorMessage | null;
  footer: PoolEditorMessage | null;
} {
  return {
    form: message?.scope === 'form' ? message : null,
    transfer: message?.scope === 'transfer' ? message : null,
    footer: message?.scope === 'footer' ? message : null,
  };
}

/**
 * Replacing the whole working copy invalidates the pending selection:
 * stale checkboxes would otherwise re-apply roles that no longer exist.
 */
function replaceWorking(pool: PoolConfig, message: PoolEditorMessage | null): PoolEditorState {
  return { working: pool, draftChampionId: null, draftRoles: [], message };
}

/** Reducer for every pool editor interaction. */
export function poolEditorReducer(
  state: PoolEditorState,
  action: PoolEditorAction,
): PoolEditorState {
  switch (action.type) {
    case 'pickChampion':
      return {
        ...state,
        draftChampionId: action.id,
        draftRoles: action.id === null ? [] : championPoolRoles(state.working, action.id),
      };
    case 'toggleRole': {
      const { draftRoles } = state;
      return {
        ...state,
        draftRoles: draftRoles.includes(action.role)
          ? draftRoles.filter((role) => role !== action.role)
          : [...draftRoles, action.role],
      };
    }
    case 'apply': {
      if (state.draftChampionId === null) return state;
      const result = setChampionRoles(state.working, state.draftChampionId, state.draftRoles);
      const message: PoolEditorMessage | null =
        result.rejectedRoles.length > 0
          ? {
              text: strings.poolFull(
                result.rejectedRoles.map((role) => strings.roleNames[role]).join(', '),
                POOL_CONFIG_MAX_PER_ROLE,
              ),
              kind: 'error',
              scope: 'form',
            }
          : null;
      // Re-sync the checkboxes with what actually landed (full roles drop out).
      return {
        ...state,
        working: result.pool,
        draftRoles: championPoolRoles(result.pool, state.draftChampionId),
        message,
      };
    }
    case 'remove': {
      const remaining = championPoolRoles(state.working, action.championId).filter(
        (role) => role !== action.role,
      );
      const working = setChampionRoles(state.working, action.championId, remaining).pool;
      const draftRoles =
        action.championId === state.draftChampionId
          ? state.draftRoles.filter((role) => role !== action.role)
          : state.draftRoles;
      return { ...state, working, draftRoles, message: null };
    }
    case 'replace':
      return replaceWorking(action.pool, action.message);
    case 'clear':
      return replaceWorking(emptyPool(), null);
    case 'message':
      return { ...state, message: action.message };
  }
}

/** Apply with no role ticked is allowed when it removes a champion already in the pool. */
export function canApplyDraft(state: PoolEditorState): boolean {
  if (state.draftChampionId === null) return false;
  return (
    state.draftRoles.length > 0 ||
    championPoolRoles(state.working, state.draftChampionId).length > 0
  );
}

/** True when the working copy differs from the stored pool (canonical serialization). */
export function isPoolDirty(working: PoolConfig, saved: PoolConfig): boolean {
  return serializePoolConfig(working) !== serializePoolConfig(saved);
}

/** Repo export writes only the saved state, so it is refused while dirty (SPECS §19.3). */
export function canExportToRepo(working: PoolConfig, saved: PoolConfig): boolean {
  return !isPoolDirty(working, saved);
}
