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

import type { ChampionId, ChampionTagsMap } from '@draftorb/shared';
import type { CompConfig } from './config.js';
import { DEFAULT_COMP_CONFIG } from './config.js';

export type CompNeedCategory = 'engage' | 'peel' | 'waveclear' | 'poke' | 'ad_damage' | 'ap_damage';

export interface CompNeedResult {
  /** Log-odds bonus for this champion filling missing needs of the team. */
  readonly bonus: number;
  /** Human-readable description of what need was filled (for UI explanation). */
  readonly reasons: readonly string[];
  /** The categories of needs this champion can fill that the team is missing. */
  readonly filled: readonly CompNeedCategory[];
}

/** Allies that have a tag entry; untagged allies carry no comp evidence. */
function taggedAllyIds(
  allyChampionIds: ReadonlyArray<ChampionId>,
  tags: ChampionTagsMap,
): ChampionId[] {
  return allyChampionIds.filter((id) => tags[id] !== undefined);
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
  const taggedAllies = taggedAllyIds(allyChampionIds, tags);
  if (taggedAllies.length === 0) return new Set<CompNeedCategory>();

  const present = new Set<CompNeedCategory>();
  let adChampions = 0;
  let apChampions = 0;
  let hasAnyDamage = false;

  for (const id of taggedAllies) {
    const t = tags[id];
    if (!t) continue;
    if (t.hardEngage) present.add('engage');
    if (t.peel) present.add('peel');
    if (t.waveclear) present.add('waveclear');
    if (t.poke) present.add('poke');
    if (t.damageType === 'AD') {
      hasAnyDamage = true;
      adChampions++;
    } else if (t.damageType === 'AP') {
      hasAnyDamage = true;
      apChampions++;
    } else if (t.damageType === 'MIXED') {
      hasAnyDamage = true;
      adChampions++;
      apChampions++;
    }
  }

  const missing = new Set<CompNeedCategory>();
  if (!present.has('engage')) missing.add('engage');
  if (!present.has('peel')) missing.add('peel');
  if (!present.has('waveclear')) missing.add('waveclear');
  if (!present.has('poke')) missing.add('poke');

  if (taggedAllies.length >= config.minAlliesForDamageMix && hasAnyDamage) {
    const total = adChampions + apChampions;
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
  const reasons: string[] = [];
  let bonus = 0;

  if (!t) {
    return { bonus: 0, reasons, filled };
  }

  const categoryMap: Array<[CompNeedCategory, boolean, number, string]> = [
    ['engage', t.hardEngage, config.engage, 'engage'],
    ['peel', t.peel, config.peel, 'peel'],
    ['waveclear', t.waveclear, config.waveclear, 'waveclear'],
    ['poke', t.poke, config.poke, 'poke'],
  ];

  for (const [cat, has, weight, label] of categoryMap) {
    if (has && missing.has(cat)) {
      filled.push(cat);
      bonus += weight;
      reasons.push(label);
    }
  }

  const taggedCount = taggedAllyIds(allyChampionIds, tags).length;

  if (taggedCount >= config.minAlliesForDamageMix && missing.has('ad_damage')) {
    const isAd = t.damageType === 'AD' || t.damageType === 'MIXED';
    if (isAd) {
      filled.push('ad_damage');
      bonus += config.adDamage;
      reasons.push('ad damage');
    }
  }

  if (taggedCount >= config.minAlliesForDamageMix && missing.has('ap_damage')) {
    const isAp = t.damageType === 'AP' || t.damageType === 'MIXED';
    if (isAp) {
      filled.push('ap_damage');
      bonus += config.apDamage;
      reasons.push('ap damage');
    }
  }

  return { bonus, reasons, filled };
}
