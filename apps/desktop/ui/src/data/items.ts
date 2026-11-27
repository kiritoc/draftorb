/**
 * Item catalog loading for the setup screen (BL-031b, SPECS §18.5).
 *
 * `<patch>/items.json` is the static Data Dragon item catalog the ETL
 * publishes next to `champions.json`/`runes.json` (SPECS §20 archive
 * layout). It resolves starter-bundle item ids to display names and CDN
 * icon paths. A missing file means "no catalog" (bundles still render
 * their stats), a corrupt file fails closed like every manifest file —
 * same contract as `data/runes.ts`.
 */

import { itemsMapSchema, type ItemsMap } from '@draftorb/shared';

import { cacheRead } from './aggregates';

/** One resolvable item catalog entry (id -> name + icon file name). */
export interface ItemIconInfo {
  readonly id: number;
  readonly name: string;
  readonly icon: string;
}

/** Index the item catalog for name/icon lookup by item id. */
export function buildItemIndex(items: ItemsMap): ReadonlyMap<number, ItemIconInfo> {
  const index = new Map<number, ItemIconInfo>();
  for (const item of Object.values(items)) {
    index.set(item.id, { id: item.id, name: item.name, icon: item.icon });
  }
  return index;
}

const ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn';

/** CDN URL for an item icon (`item/2052.png` -> `img/item/2052.png`); null without a version. */
export function itemIconUrl(version: string | null, icon: string): string | null {
  if (version === null || icon === '') return null;
  return `${ICON_BASE}/${version}/img/item/${encodeURIComponent(icon)}`;
}

/**
 * Loads `<patch>/items.json` from the data cache. Returns null when the
 * cached release has no catalog; throws on invalid JSON or a schema
 * failure (fail-closed, same contract as the other manifest files).
 */
export async function loadItemCatalog(patch: string): Promise<ItemsMap | null> {
  const raw = await cacheRead(`${patch}/items.json`);
  if (raw === null) return null;
  return itemsMapSchema.parse(JSON.parse(raw));
}
