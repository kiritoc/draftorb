import { patchLabels } from './patch-labels';
import { strings } from './strings';

/** BL-010b produces `loaded` (`patch` is the internal `major.minor` label); the skeleton only has `none`. */
export type DataStatus = { kind: 'none' } | { kind: 'loaded'; patch: string; generatedAt: string };

export function describeDataStatus(status: DataStatus): { patch: string; freshness: string } {
  if (status.kind === 'none') {
    return { patch: strings.patchNone, freshness: strings.dataNone };
  }
  const labels = patchLabels(status.patch);
  return {
    patch:
      labels.public === null
        ? strings.patchInternalOnly(labels.internal)
        : strings.patchBoth(labels.public, labels.internal),
    freshness: strings.dataLoaded(status.generatedAt),
  };
}
