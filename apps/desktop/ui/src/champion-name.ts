/**
 * Champion display-name lookup shared by the recommendation cards and the
 * unavailable-pool cards: catalogue name when known, a labeled fallback
 * otherwise (golden rule 8 — never a blank or invented name).
 */

import type { Champion, ChampionId } from '@draftorb/shared';
import { strings } from './strings';

export function championName(champions: readonly Champion[], id: ChampionId): string {
  return champions.find((champion) => champion.id === id)?.name ?? strings.championFallback(id);
}
