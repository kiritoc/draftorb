import { strings } from './strings';

/** BL-010b produces `loaded`; the skeleton only ever has `none`. */
export type DataStatus =
  { kind: 'none' } | { kind: 'loaded'; patchPublic: string; generatedAt: string };

export function describeDataStatus(status: DataStatus): { patch: string; freshness: string } {
  if (status.kind === 'none') return { patch: strings.patchUnknown, freshness: strings.dataNone };
  return { patch: status.patchPublic, freshness: strings.dataLoaded(status.generatedAt) };
}
