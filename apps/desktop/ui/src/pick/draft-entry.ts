/**
 * Fast draft entry helpers (BL-022, SPECS §2/§10).
 *
 * The pick screen's entry bar targets one slot at a time: the ten pick
 * slots (you, four allies, five enemies) plus a ban pseudo-target. This
 * module owns the target ordering, the digit-key mapping and the ban-list
 * rules so the component stays a thin view. Pure: no DOM, no I/O.
 */

import type { ChampionId } from '@draftorb/shared';

/** A pick slot that can receive a champion through the entry bar. */
export type PickTarget =
  | { readonly kind: 'user' }
  | { readonly kind: 'ally'; readonly index: number }
  | { readonly kind: 'enemy'; readonly index: number };

/** Entry order: your pick first, then allies, then enemies. */
export const PICK_TARGETS: readonly PickTarget[] = [
  { kind: 'user' },
  { kind: 'ally', index: 0 },
  { kind: 'ally', index: 1 },
  { kind: 'ally', index: 2 },
  { kind: 'ally', index: 3 },
  { kind: 'enemy', index: 0 },
  { kind: 'enemy', index: 1 },
  { kind: 'enemy', index: 2 },
  { kind: 'enemy', index: 3 },
  { kind: 'enemy', index: 4 },
];

export const PICK_TARGET_COUNT = PICK_TARGETS.length;

/** Entry-bar index of the ban pseudo-target (one past the last pick slot). */
export const BAN_TARGET = PICK_TARGET_COUNT;

/** Total entry-bar targets: ten picks plus the ban target. */
export const ENTRY_TARGET_COUNT = PICK_TARGET_COUNT + 1;

/** Maximum bans per draft — mirrors `draftInputSchema`'s `.max(10)` (SPECS §2). */
export const BAN_LIMIT = 10;

/**
 * Maps a digit key to a pick-target index: '1'..'9' -> 0..8, '0' -> 9.
 * Returns null for anything else (the key stays a normal search character).
 */
export function targetIndexForDigit(key: string): number | null {
  if (key.length !== 1) return null;
  const code = key.charCodeAt(0);
  if (code >= 49 && code <= 57) return code - 49; // '1'..'9' -> 0..8
  if (code === 48) return 9; // '0' -> 9
  return null;
}

export function isPickTargetIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < PICK_TARGET_COUNT;
}

/**
 * Index of the next pick target without a champion, scanning forward from
 * `from` (exclusive) and wrapping once. Returns `from` when every slot is
 * filled, so re-picking the active slot stays possible.
 */
export function nextEmptyTarget(filled: ReadonlySet<number>, from: number): number {
  for (let step = 1; step <= PICK_TARGET_COUNT; step += 1) {
    const index = (from + step) % PICK_TARGET_COUNT;
    if (!filled.has(index)) return index;
  }
  return from;
}

/** A ban is allowed while the list is under the limit and the champion is neither banned nor picked. */
export function canBan(
  bans: readonly ChampionId[],
  championId: ChampionId,
  pickedIds: ReadonlySet<ChampionId>,
): boolean {
  return bans.length < BAN_LIMIT && !bans.includes(championId) && !pickedIds.has(championId);
}

/** Appends `championId` to the ban list; returns null when `canBan` fails. */
export function addBan(
  bans: readonly ChampionId[],
  championId: ChampionId,
  pickedIds: ReadonlySet<ChampionId>,
): ChampionId[] | null {
  if (!canBan(bans, championId, pickedIds)) return null;
  return [...bans, championId];
}

export function removeBan(bans: readonly ChampionId[], championId: ChampionId): ChampionId[] {
  return bans.filter((id) => id !== championId);
}

export function lastBan(bans: readonly ChampionId[]): ChampionId | undefined {
  return bans[bans.length - 1];
}
