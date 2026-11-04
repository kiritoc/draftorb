/**
 * @draftorb/shared — Manifest schema.
 *
 * The manifest describes a generated data release: patch, region, rank buckets
 * (the 8 SPECS §3 buckets, not the 10 raw tiers), the roles present in the
 * `roles/<ROLE>/` directory, and the list of export files with optional SHA-256
 * checksums. `schemaVersion` is a shared literal (`MANIFEST_SCHEMA_VERSION`)
 * agreed between the exporter (ETL) and the loader (web) before either is
 * implemented; the web app checks it and shows a clear error on mismatch.
 */

import { z } from 'zod';

import { MANIFEST_SCHEMA_VERSION, rankBucketSchema, roleSchema } from './core.js';

export const manifestFileSchema = z
  .object({
    path: z.string().min(1),
    sha256: z.string().optional(),
  })
  .strict();

export const manifestSchema = z
  .object({
    patch: z.string().min(1),
    generatedAt: z.string().min(1),
    region: z.string().min(1),
    rankBuckets: z.array(rankBucketSchema),
    roles: z.array(roleSchema),
    files: z.array(manifestFileSchema),
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Version of the `latest.json` patch pointer (D-051). Bumped when the pointer
 * format changes.
 */
export const LATEST_SCHEMA_VERSION = 1;

export const latestSchema = z
  .object({
    schemaVersion: z.literal(LATEST_SCHEMA_VERSION),
    patch: z.string().min(1),
    manifest: z.string().min(1),
    generatedAt: z.string().min(1),
  })
  .strict();
export type Latest = z.infer<typeof latestSchema>;
