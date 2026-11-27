/**
 * Summoner-spell display names (BL-031b, SPECS §18.5).
 *
 * The aggregate export carries spell ids only — no spell catalog is
 * published yet (D-139 PROPOSED). This small static map covers the standard
 * Data Dragon `summoner.json` ids, including the `_Jade` role-quest
 * variants; an unknown id falls back to a labeled `Spell <id>` so a new
 * spell never renders blank or invented (golden rule 8).
 */

import { strings } from '../strings';

const SUMMONER_SPELL_NAMES: Readonly<Record<number, string>> = {
  1: 'Cleanse',
  3: 'Exhaust',
  4: 'Flash',
  6: 'Ghost',
  7: 'Heal',
  11: 'Smite',
  12: 'Teleport',
  13: 'Clarity',
  14: 'Ignite',
  21: 'Barrier',
  30: "To the King's Call",
  31: 'Poro Toss',
  32: 'Snowball',
  54: 'Comeback',
  75: 'Clairvoyance',
  // _Jade role-quest variants (same display name as the base spell).
  71: 'Cleanse',
  73: 'Exhaust',
  74: 'Flash',
  76: 'Ghost',
  77: 'Heal',
  705: 'Fortify',
  709: 'Rally',
  711: 'Smite',
  712: 'Teleport',
  713: 'Clarity',
  714: 'Ignite',
  716: 'Surge',
  720: 'Promote',
  721: 'Barrier',
  777: 'Revive',
  2201: 'Flee',
  2202: 'Flash',
};

/** Display name of a summoner spell id; labeled fallback when unmapped. */
export function summonerSpellName(id: number): string {
  return SUMMONER_SPELL_NAMES[id] ?? strings.summonerSpellFallback(id);
}

/** "Flash + Ignite" label of a normalized `[minId, maxId]` spell pair. */
export function summonerSpellPairLabel(spells: readonly [number, number]): string {
  return `${summonerSpellName(spells[0])} + ${summonerSpellName(spells[1])}`;
}
