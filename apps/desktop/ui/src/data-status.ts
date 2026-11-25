import type { DataLoad } from './data/aggregates';
import { patchLabels } from './patch-labels';
import { strings } from './strings';

/** Launch data state produced by `ensureData` (BL-010b): `loaded` carries the
 * internal `major.minor` patch label, `stale` marks the offline cache fallback. */
export type DataStatus = DataLoad;

export function describeDataStatus(status: DataStatus): { patch: string; freshness: string } {
  if (status.kind === 'none') {
    return { patch: strings.patchNone, freshness: strings.dataNone };
  }
  const labels = patchLabels(status.patch);
  const freshness =
    status.stale === true
      ? strings.dataStale(status.generatedAt)
      : strings.dataLoaded(status.generatedAt);
  return {
    patch:
      labels.public === null
        ? strings.patchInternalOnly(labels.internal)
        : strings.patchBoth(labels.public, labels.internal),
    freshness,
  };
}
