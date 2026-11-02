import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ChampionRoleProbabilities, ChampionsMap, Role } from '@draftorb/shared';

import { defaultPublicDataDir, resolveRepoRoot } from '../config/paths';
import { invalidateManifest } from '../public-data';
import { applyDerivedRoles } from '../derive-roles';
import { computeRoleProb, latestPatch, PATCH_PATTERN } from '../aggregate';
import { UsageError } from '../cli-args';
import { log, parsePositionals, type Command } from './shared';

function resolveDbPath(): string {
  const chosen = process.env.DRAFTORB_DB_PATH ?? join(resolveRepoRoot(), 'data', 'DraftOrb.sqlite');
  return resolve(chosen);
}

export async function runDeriveRoles(args: string[]): Promise<void> {
  const [patch] = parsePositionals(args, 1, 'derive-roles [patch]');
  if (patch !== undefined && !PATCH_PATTERN.test(patch)) {
    throw new UsageError(`Invalid patch "${patch}". Expected a format like "16.21".`);
  }

  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    log.info(`no database at ${dbPath}`);
    return;
  }

  const db = new Database(dbPath);
  let targetPatch: string | undefined;
  let rows: { championId: number; role: string; prob: number }[] = [];
  try {
    targetPatch = patch ?? latestPatch(db);
    if (targetPatch !== undefined) {
      // Compute for the target patch directly: `role_prob` has no patch column
      // and may hold another patch's aggregation.
      rows = computeRoleProb(db, targetPatch);
    }
  } finally {
    db.close();
  }

  if (targetPatch === undefined) {
    log.info('no patch found in the database; nothing to derive');
    return;
  }

  const roleProbabilities: ChampionRoleProbabilities = {};
  for (const row of rows) {
    (roleProbabilities[String(row.championId)] ??= {})[row.role as Role] = row.prob;
  }

  // DRAFTORB_PUBLIC_DIR overrides the default public data dir (tests only).
  const publicDir = process.env.DRAFTORB_PUBLIC_DIR ?? defaultPublicDataDir();
  const championsPath = join(publicDir, targetPatch, 'champions.json');
  if (!existsSync(championsPath)) {
    log.info(`no champions.json at ${championsPath}; nothing to rewrite`);
    return;
  }

  // Fallback roles must come from an unmodified source: snapshot the
  // tag-bootstrap catalog on first run (or after `static` rewrote it) and
  // always derive from that snapshot.
  const bootstrapPath = join(publicDir, targetPatch, 'champions.bootstrap.json');
  const current = readFileSync(championsPath, 'utf8');
  const marker = join(publicDir, targetPatch, 'champions.derived.json');
  const staticRewrote = !existsSync(marker) || readFileSync(marker, 'utf8') !== current;
  if (!existsSync(bootstrapPath) || staticRewrote) {
    writeFileSync(bootstrapPath, current, 'utf-8');
  }
  const champions = JSON.parse(readFileSync(bootstrapPath, 'utf8')) as unknown;
  const updated = applyDerivedRoles(champions as ChampionsMap, roleProbabilities);
  const serialized = JSON.stringify(updated, null, 2);
  invalidateManifest(join(publicDir, targetPatch));
  writeFileSync(championsPath, serialized, 'utf-8');
  writeFileSync(marker, serialized, 'utf-8');

  log.info(
    `Derived champion roles from role-prob data for ${Object.keys(updated).length} champions -> ${championsPath}`,
  );
}

export const deriveRolesCommand: Command = {
  name: 'derive-roles',
  usage: 'derive-roles [patch]',
  description: 'Rewrite champions.json.roles from observed role-prob data',
  run: runDeriveRoles,
};
