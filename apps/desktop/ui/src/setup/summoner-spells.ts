/**
 * Summoner-spell display names (BL-031b, SPECS §18.5).
 *
 * The aggregate export carries spell ids only — no spell catalog is
 * published yet (D-139 PROPOSED), so the names live in `strings.ts` like
 * every other user-visible text. The map covers the standard Data Dragon
 * `summoner.json` ids, including the `_Jade` role-quest variants; an
 * unknown id falls back to a labeled `Spell <id>` so a new spell never
 * renders blank or invented (golden rule 8).
 */

import { strings } from '../strings';

/** Display name of a summoner spell id; labeled fallback when unmapped. */
export function summonerSpellName(id: number): string {
  return strings.summonerSpellNames[id] ?? strings.summonerSpellFallback(id);
}

/** "Flash + Ignite" label of a normalized `[minId, maxId]` spell pair. */
export function summonerSpellPairLabel(spells: readonly [number, number]): string {
  return `${summonerSpellName(spells[0])} + ${summonerSpellName(spells[1])}`;
}
