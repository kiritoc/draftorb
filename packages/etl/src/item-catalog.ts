/**
 * @draftorb/etl — Per-patch Data Dragon item catalog loader.
 *
 * Shared by timeline ingestion (`etl timeline`, T-051) and item-build
 * aggregation: resolves each stored `matches.patch` label ("16.22") to its
 * full Data Dragon version ("16.22.1") once per run and caches the parsed
 * `item.json` catalog per patch.
 */

import type { ItemsMap } from '@draftorb/shared';

import { fetchItems } from './ddragon';
import { fetchPatchVersions, parsePatchLabel } from './patches';

/** patch label -> full Data Dragon version (e.g. "16.22" -> "16.22.1"). */
async function resolvePatchVersions(fetchFn: typeof fetch): Promise<Map<string, string>> {
  const versions = await fetchPatchVersions(fetchFn);
  const byLabel = new Map<string, string>();
  for (const version of versions) {
    const label = parsePatchLabel(version);
    if (label !== null && !byLabel.has(label)) {
      byLabel.set(label, version);
    }
  }
  return byLabel;
}

/**
 * Items catalog per patch label, fetched lazily and cached for the run.
 * A patch whose catalog cannot be fetched resolves to `null` (callers decide
 * whether to skip or degrade; a wrong-patch catalog is never substituted).
 */
export function createItemCatalogLoader(
  fetchFn: typeof fetch,
  onWarn?: (message: string) => void,
): (patch: string) => Promise<ItemsMap | null> {
  const cache = new Map<string, Promise<ItemsMap | null>>();
  let versionsPromise: Promise<Map<string, string>> | null = null;

  return (patch: string) => {
    let pending = cache.get(patch);
    if (pending === undefined) {
      pending = (async () => {
        versionsPromise ??= resolvePatchVersions(fetchFn).catch((error: unknown) => {
          versionsPromise = null;
          throw error;
        });
        const versions = await versionsPromise;
        const version = versions.get(patch);
        if (version === undefined) {
          onWarn?.(`no Data Dragon version found for patch ${patch}`);
          return null;
        }
        return fetchItems(version, fetchFn);
      })().catch((error: unknown) => {
        onWarn?.(
          `item catalog fetch failed for patch ${patch}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
      cache.set(patch, pending);
    }
    return pending;
  };
}
