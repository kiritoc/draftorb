/**
 * @draftorb/etl — Exported `manifest.json`.
 *
 * The manifest lists every export file with its sha256 (B2). `bytes` is not
 * emitted because `manifestFileSchema` does not allow it. The manifest itself
 * is not listed in its own `files`. Written last (inside the temp dir) so a
 * partially written manifest never replaces the previous export (C4).
 */

import { MANIFEST_SCHEMA_VERSION, manifestSchema, type Manifest } from '@draftorb/shared';
import type { ExportFile } from './io.js';

const RANK_BUCKETS: readonly string[] = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER_PLUS',
];

export interface ManifestInput {
  patch: string;
  generatedAt: string;
  region: string;
  roles: readonly string[];
  files: ExportFile[];
}

export function buildManifest(input: ManifestInput): Manifest {
  const files = [...input.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return manifestSchema.parse({
    patch: input.patch,
    generatedAt: input.generatedAt,
    region: input.region,
    rankBuckets: [...RANK_BUCKETS],
    roles: [...input.roles],
    files: files.map((f) => ({ path: f.relativePath, sha256: f.sha256 })),
    schemaVersion: MANIFEST_SCHEMA_VERSION,
  });
}
