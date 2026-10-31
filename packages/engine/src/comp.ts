/**
 * @draftorb/engine — Composition needs calculation.
 *
 * Pure, deterministic. Computes a log-odds bonus for filling missing team
 * composition needs (engagement, peeling, waveclear, damage diversity) from
 * champion tags (SPECS §6). The bonus is small in log-odds units and is
 * explained in the UI as a `comp` reason (SPECS §7).
 *
 * The full comp model is expanded in T-025; this is a minimal implementation
 * sufficient for T-023.
 */

import type { ChampionId, ChampionTags, ChampionTagsMap, CompNeedCategory } from '@draftorb/shared';
import type { CompConfig } from './config.js';
import { DEFAULT_COMP_CONFIG } from './config.js';

export type { CompNeedCategory } from '@draftorb/shared';

export interface CompNeedResult {
  /** Log-odds bonus for this champion filling missing needs of the team. */
  readonly bonus: number;
  /** The categories (machine codes; the web `strings` module renders them) of needs this champion can fill that the team is missing. */
  readonly filled: readonly CompNeedCategory[];
}

/** Tag entries of the allies; untagged allies carry no comp evidence. */
function taggedAllies(
  allyChampionIds: ReadonlyArray<ChampionId>,
  tags: ChampionTagsMap,
): ChampionTags[] {
  return allyChampionIds.flatMap((id) => {
    const t = tags[id];
    return t ? [t] : [];
  });
}

/**
 * Compute the team's missing composition needs based on the known ally champions
 * (excluding the candidate `c` itself). Returns the categories the team lacks.
 */
export function teamMissingNeeds(
  allyChampionIds: ReadonlyArray<ChampionId>,
  tags: ChampionTagsMap,
  config: CompConfig = DEFAULT_COMP_CONFIG,
): Set<CompNeedCategory> {
  // Only tagged allies are evidence. With no tagged ally there is no evidence
  // of any gap, so no need is reported (otherwise every candidate would get an
  // identical, meaningless comp bonus).
  const allyTags = taggedAllies(allyChampionIds, tags);
  if (allyTags.length === 0) return new Set<CompNeedCategory>();

  const present = new Set<CompNeedCategory>();
  let adChampions = 0;
  let apChampions = 0;

  for (const t of allyTags) {
    if (t.hardEngage) present.add('engage');
    if (t.peel) present.add('peel');
    if (t.waveclear) present.add('waveclear');
    if (t.poke) present.add('poke');
    if (t.damageType === 'AD' || t.damageType === 'MIXED') adChampions++;
    if (t.damageType === 'AP' || t.damageType === 'MIXED') apChampions++;
  }

  const missing = new Set<CompNeedCategory>();
  if (!present.has('engage')) missing.add('engage');
  if (!present.has('peel')) missing.add('peel');
  if (!present.has('waveclear')) missing.add('waveclear');
  if (!present.has('poke')) missing.add('poke');

  const total = adChampions + apChampions;
  if (allyTags.length >= config.minAlliesForDamageMix && total > 0) {
    if (adChampions / total < config.missingThreshold) missing.add('ad_damage');
    if (apChampions / total < config.missingThreshold) missing.add('ap_damage');
  }

  return missing;
}

/**
 * Compute the comp bonus for a champion `c` filling needs that the team lacks.
 */
export function computeCompNeed(
  c: ChampionId,
  allyChampionIds: ReadonlyArray<ChampionId>,
  tags: ChampionTagsMap,
  config: CompConfig = DEFAULT_COMP_CONFIG,
): CompNeedResult {
  const missing = teamMissingNeeds(allyChampionIds, tags, config);
  const t = tags[c];
  const filled: CompNeedCategory[] = [];
  let bonus = 0;

  if (!t) {
    return { bonus: 0, filled };
  }

  // ad_damage/ap_damage are only ever missing once the damage-mix gate passed.
  const categoryMap: Array<[CompNeedCategory, boolean, number]> = [
    ['engage', t.hardEngage, config.engage],
    ['peel', t.peel, config.peel],
    ['waveclear', t.waveclear, config.waveclear],
    ['poke', t.poke, config.poke],
    ['ad_damage', t.damageType === 'AD' || t.damageType === 'MIXED', config.ad_damage],
    ['ap_damage', t.damageType === 'AP' || t.damageType === 'MIXED', config.ap_damage],
  ];

  for (const [cat, has, weight] of categoryMap) {
    if (has && missing.has(cat)) {
      filled.push(cat);
      bonus += weight;
    }
  }

  return { bonus, filled };
}
