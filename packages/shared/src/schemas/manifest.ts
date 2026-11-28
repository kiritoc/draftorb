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
    /**
     * Subset of `roles` exported at champion-level statistics only
     * (baseline.json, no pair/lane/rune/build files) — ADC and MID (D-097,
     * BL-024). Empty when every exported role has the full layout.
     */
    minimalRoles: z.array(roleSchema),
    files: z.array(manifestFileSchema),
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Manifest schema version 4 — the layout published before BL-024 added
 * `minimalRoles` (schema v5). Frozen on purpose: it must keep accepting
 * exactly the v4 shape so the ETL latest-pointer guard can tell an intact
 * older export from a corrupt one (PR #161 review).
 */
export const manifestSchemaV4 = z
  .object({
    patch: z.string().min(1),
    generatedAt: z.string().min(1),
    region: z.string().min(1),
    rankBuckets: z.array(rankBucketSchema),
    roles: z.array(roleSchema),
    files: z.array(manifestFileSchema),
    schemaVersion: z.literal(4),
  })
  .strict();
export type ManifestV4 = z.infer<typeof manifestSchemaV4>;

/**
 * Manifest schema version 5 — the layout published before BL-013a added
 * `players` to item build entries (schema v6). Frozen on purpose: it must
 * keep accepting exactly the v5 shape so the ETL latest-pointer guard can
 * tell an intact older export from a corrupt one (same pattern as v4).
 */
export const manifestSchemaV5 = z
  .object({
    patch: z.string().min(1),
    generatedAt: z.string().min(1),
    region: z.string().min(1),
    rankBuckets: z.array(rankBucketSchema),
    roles: z.array(roleSchema),
    minimalRoles: z.array(roleSchema),
    files: z.array(manifestFileSchema),
    schemaVersion: z.literal(5),
  })
  .strict();
export type ManifestV5 = z.infer<typeof manifestSchemaV5>;

/**
 * Manifest schema version 6 — the layout published by BL-013a before
 * BL-052 added `pick-rate-samples.json` (schema v7). Frozen on purpose:
 * it must keep accepting exactly the v6 shape so the ETL latest-pointer
 * guard and the desktop offline cache can tell an intact older export
 * from a corrupt one.
 */
export const manifestSchemaV6 = z
  .object({
    patch: z.string().min(1),
    generatedAt: z.string().min(1),
    region: z.string().min(1),
    rankBuckets: z.array(rankBucketSchema),
    roles: z.array(roleSchema),
    minimalRoles: z.array(roleSchema),
    files: z.array(manifestFileSchema),
    schemaVersion: z.literal(6),
  })
  .strict();
export type ManifestV6 = z.infer<typeof manifestSchemaV6>;

/**
 * Manifest schema version 7 — the layout published by BL-052 before
 * BL-031a added the summoner/starter export files (schema v8). Frozen on
 * purpose: it must keep accepting exactly the v7 shape so the ETL
 * latest-pointer guard and the desktop offline cache can tell an intact
 * older export from a corrupt one.
 */
export const manifestSchemaV7 = z
  .object({
    patch: z.string().min(1),
    generatedAt: z.string().min(1),
    region: z.string().min(1),
    rankBuckets: z.array(rankBucketSchema),
    roles: z.array(roleSchema),
    minimalRoles: z.array(roleSchema),
    files: z.array(manifestFileSchema),
    schemaVersion: z.literal(7),
  })
  .strict();
export type ManifestV7 = z.infer<typeof manifestSchemaV7>;

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

/**
 * `patch-meta.json` — the patch-catalog state of the last aggregate run
 * (D-055), exported verbatim from the ETL `ingest_state` snapshot. Written
 * only when an aggregate run recorded it; older exports omit the file.
 */
export const patchMetaSchema = z
  .object({
    /** Snapshot patch label; null when the database had no stored patch. */
    patch: z.string().min(1).nullable(),
    /** `patch_index` of `patch` in the catalog (null when unresolvable). */
    patchIndex: z.number().int().nullable(),
    /** `currentPatchIndex` the aggregators used for recency (-1 when empty). */
    currentPatchIndex: z.number().int(),
    /** Highest `patch_index` in `patches` at aggregate time (null when empty). */
    patchesMaxIndex: z.number().int().nullable(),
    /** ISO timestamp of the aggregate run. */
    aggregatedAt: z.string().min(1),
  })
  .strict();
export type PatchMeta = z.infer<typeof patchMetaSchema>;
