/**
 * Profile matchup-context verification (BL-056 / issue #184, D-142 PROPOSED).
 *
 * Read-only diagnostic: runs `recommendProfileRunes`/`recommendProfileSpells`
 * for the most-played champion of each in-scope role (SUPPORT/TOP/JUNGLE)
 * against the local profile export and prints which fallback level each
 * setup resolves at, plus the raw per-level match counts (L1/L2/L3) so the
 * per-role matchup predicates (D-142) can be checked on real data.
 *
 * Usage (repo root, after `pnpm etl pull` or `profile-sync` produced
 * data/public):
 *   pnpm exec tsx scripts/verify-profile-matchup.ts
 *
 * Data sources (all local, gitignored, never committed):
 *   data/public/latest.json                     -> active patch directory
 *   data/public/<patch>/role-prob.json          -> role probabilities
 *   data/public/profiles/index.json + <id>.json -> profile export (first entry)
 *   data/manual/champion-tags.json              -> champion tags (L3 signature)
 *
 * The script exits non-zero with a clear message when the exports are absent
 * (fresh clone, no synced data) — it is a manual verification aid, not part
 * of `pnpm check`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  championRoleProbabilitiesSchema,
  championTagsMapSchema,
  profileExportSchema,
  profileIndexSchema,
  type ProfileExport,
  type ProfileGame,
  type RecommendData,
  type Role,
} from '../packages/shared/src/index.js';
import { inferRoles } from '../packages/engine/src/roles.js';
import {
  matchupIdsMatch,
  resolveMatchupSpec,
  roleMatchupSpec,
  type MatchupIdLookup,
} from '../packages/engine/src/matchup-context.js';
import {
  recommendProfileRunes,
  recommendProfileSpells,
} from '../packages/engine/src/profile-setup.js';
import type { PersonalizeContext } from '../packages/engine/src/personalize.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'data', 'public');
const NOW_MS = Date.now();

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadInputs(): { profile: ProfileExport; data: RecommendData } {
  const latest = readJson(join(PUBLIC_DIR, 'latest.json')) as { patch?: string };
  if (typeof latest.patch !== 'string') {
    throw new Error('data/public/latest.json has no patch field — run the ETL first');
  }
  const patchDir = join(PUBLIC_DIR, latest.patch);
  const roleProb = championRoleProbabilitiesSchema.parse(
    readJson(join(patchDir, 'role-prob.json')),
  );
  const tags = championTagsMapSchema.parse(
    readJson(join(ROOT, 'data', 'manual', 'champion-tags.json')),
  );
  const index = profileIndexSchema.parse(readJson(join(PUBLIC_DIR, 'profiles', 'index.json')));
  const entry = index.profiles[0];
  if (entry === undefined) {
    throw new Error('data/public/profiles/index.json lists no profile');
  }
  const profile = profileExportSchema.parse(readJson(join(PUBLIC_DIR, 'profiles', entry.file)));
  return { profile, data: { roleProb, tags } as unknown as RecommendData };
}

/**
 * Mirror of `profile-setup.ts` internals (not exported): stored SUPPORT/ADC
 * ids stay exact, the remaining enemy roles come from `inferRoles` over
 * `enemyChampionIds`. Duplicated here so the per-level match counts can be
 * reported independently of the engine's internal aggregation.
 */
function gameEnemyRoleIds(
  game: ProfileGame,
  roleProb: RecommendData['roleProb'],
): Partial<Record<Role, number>> {
  const result: Partial<Record<Role, number>> = {};
  const known = new Set<number>();
  const slots: Array<{ championId: number; role?: Role }> = [];
  if (game.enemySupportId !== null) {
    result.SUPPORT = game.enemySupportId;
    known.add(game.enemySupportId);
    slots.push({ championId: game.enemySupportId, role: 'SUPPORT' });
  }
  if (game.enemyAdcId !== null) {
    result.ADC = game.enemyAdcId;
    known.add(game.enemyAdcId);
    slots.push({ championId: game.enemyAdcId, role: 'ADC' });
  }
  for (const championId of [...new Set(game.enemyChampionIds)].sort((a, b) => a - b)) {
    if (!known.has(championId)) slots.push({ championId });
  }
  if (slots.length > 0 && slots.length <= 5) {
    const assignment = inferRoles(slots, roleProb);
    if (assignment !== null) {
      for (const slot of assignment.slots) result[slot.role] = slot.championId;
    }
  }
  return result;
}

function gameMatchupLookup(
  game: ProfileGame,
  enemyRoleIds: Readonly<Partial<Record<Role, number>>>,
): MatchupIdLookup {
  return (side, slotRole) => {
    if (side === 'ally') return slotRole === 'ADC' ? game.allyAdcId : null;
    if (slotRole === 'SUPPORT') return game.enemySupportId;
    if (slotRole === 'ADC') return game.enemyAdcId;
    return enemyRoleIds[slotRole] ?? null;
  };
}

function gameSignature(game: ProfileGame, tags: RecommendData['tags']): ReadonlySet<string> {
  const signature = new Set<string>();
  for (const championId of game.enemyChampionIds) {
    const t = tags[String(championId)];
    if (t !== undefined) signature.add(`${t.damageType}:${t.archetype}`);
  }
  return signature;
}

/** Most frequent value of `pick(game)`; ties break on the smaller id. */
function mostCommon<T extends number | string>(
  games: readonly ProfileGame[],
  pick: (game: ProfileGame) => T | null,
): T | null {
  const counts = new Map<T, number>();
  for (const game of games) {
    const value = pick(game);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of [...counts.entries()].sort((a, b) =>
    typeof a[0] === 'number' && typeof b[0] === 'number'
      ? a[0] - b[0]
      : String(a[0]).localeCompare(String(b[0])),
  )) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function mostCommonPair(
  games: readonly ProfileGame[],
  pickA: (game: ProfileGame) => number | null,
  pickB: (game: ProfileGame) => number | null,
): [number, number] | null {
  const counts = new Map<string, { pair: [number, number]; count: number }>();
  for (const game of games) {
    const a = pickA(game);
    const b = pickB(game);
    if (a === null || b === null) continue;
    const key = `${a}:${b}`;
    const existing = counts.get(key);
    if (existing === undefined) counts.set(key, { pair: [a, b], count: 1 });
    else existing.count += 1;
  }
  let best: { pair: [number, number]; count: number } | null = null;
  for (const entry of counts.values()) {
    if (best === null || entry.count > best.count) best = entry;
  }
  return best?.pair ?? null;
}

const IN_SCOPE_ROLES: readonly Role[] = ['SUPPORT', 'TOP', 'JUNGLE'];

/** Primary/secondary enemy roles per spec, mirroring roleMatchupSpec. */
const ROLE_SLOTS: Record<Role, { primary: Role; secondary: Role | null }> = {
  SUPPORT: { primary: 'SUPPORT', secondary: null },
  TOP: { primary: 'TOP', secondary: 'JUNGLE' },
  JUNGLE: { primary: 'JUNGLE', secondary: 'MID' },
  ADC: { primary: 'ADC', secondary: null },
  MID: { primary: 'MID', secondary: null },
};

function main(): void {
  const { profile, data } = loadInputs();
  console.log(
    `profile: ${profile.id} (${profile.gameCount} games exported, ${profile.games.length} loaded)`,
  );
  console.log(`patch data: role-prob + champion-tags loaded\n`);

  for (const role of IN_SCOPE_ROLES) {
    const roleGames = profile.games.filter((g) => g.role === role);
    if (roleGames.length === 0) {
      console.log(`=== ${role}: no games in export, skipped`);
      continue;
    }
    const champCounts = new Map<number, number>();
    for (const g of roleGames)
      champCounts.set(g.championId, (champCounts.get(g.championId) ?? 0) + 1);
    const championId = [...champCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0] - b[0],
    )[0]?.[0];
    if (championId === undefined) continue;
    const champGames = roleGames.filter((g) => g.championId === championId);

    const slots = ROLE_SLOTS[role];
    const enemyIdsOf = (g: ProfileGame) => gameEnemyRoleIds(g, data.roleProb);
    // Context built from the champion's own most common enemy-role pair, so
    // the L1/L2 predicates have a realistic target on real data.
    const pair = mostCommonPair(
      champGames,
      (g) => enemyIdsOf(g)[slots.primary] ?? null,
      (g) => (slots.secondary === null ? null : (enemyIdsOf(g)[slots.secondary] ?? null)),
    );
    const primaryId = mostCommon(champGames, (g) => enemyIdsOf(g)[slots.primary] ?? null);
    const enemyRoleIds: Partial<Record<Role, number>> = {};
    if (primaryId !== null) enemyRoleIds[slots.primary] = primaryId;
    if (pair !== null && slots.secondary !== null) {
      enemyRoleIds[slots.secondary] = pair[1];
    }

    // L3 demo: signature of the champion's most common enemy team.
    const teamCounts = new Map<string, { ids: number[]; count: number }>();
    for (const g of champGames) {
      const key = [...new Set(g.enemyChampionIds)].sort((a, b) => a - b).join(',');
      const existing = teamCounts.get(key);
      if (existing === undefined) teamCounts.set(key, { ids: [...g.enemyChampionIds], count: 1 });
      else existing.count += 1;
    }
    const topTeam = [...teamCounts.values()].sort((a, b) => b.count - a.count)[0];
    const enemySignature = new Set<string>();
    for (const id of topTeam?.ids ?? []) {
      const t = data.tags[String(id)];
      if (t !== undefined) enemySignature.add(`${t.damageType}:${t.archetype}`);
    }

    const context: PersonalizeContext = {
      role,
      allyAdcId: mostCommon(champGames, (g) => g.allyAdcId),
      enemySupportId: mostCommon(champGames, (g) => g.enemySupportId),
      enemyRoleIds,
      enemySignature,
      rankBucket: 'DIAMOND',
    };

    console.log(
      `=== ${role}: ${roleGames.length} games in role; champion ${championId} (${champGames.length} games)`,
    );
    console.log(
      `    context enemyRoleIds=${JSON.stringify(enemyRoleIds)} signatureSize=${enemySignature.size}`,
    );

    // Per-level raw match counts, replicating the spec semantics.
    const spec = roleMatchupSpec(role);
    const ctxMatchup =
      spec === null
        ? null
        : resolveMatchupSpec(spec, (side, slotRole) => {
            if (side === 'ally') {
              return slotRole === 'ADC' ? context.allyAdcId : null;
            }
            if (slotRole === 'SUPPORT') return context.enemySupportId;
            if (slotRole === 'ADC') return context.enemyRoleIds?.ADC ?? null;
            return context.enemyRoleIds?.[slotRole] ?? null;
          });
    let l1 = 0;
    let l2 = 0;
    let l3 = 0;
    let unresolved = 0;
    for (const game of champGames) {
      const enemyIds = gameEnemyRoleIds(game, data.roleProb);
      const gameMatchup =
        spec === null ? null : resolveMatchupSpec(spec, gameMatchupLookup(game, enemyIds));
      const gs = gameSignature(game, data.tags);
      const l1ok =
        ctxMatchup !== null &&
        gameMatchup !== null &&
        matchupIdsMatch(ctxMatchup.l1, gameMatchup.l1);
      const l2ok =
        ctxMatchup !== null &&
        gameMatchup !== null &&
        matchupIdsMatch(ctxMatchup.l2, gameMatchup.l2);
      const l3ok = enemySignature.size > 0 && [...enemySignature].every((pair2) => gs.has(pair2));
      if (
        gameMatchup !== null &&
        gameMatchup.l1.concat(gameMatchup.l2).every((id) => id === null)
      ) {
        unresolved += 1;
      }
      if (l1ok) l1 += 1;
      else if (l2ok) l2 += 1;
      else if (l3ok) l3 += 1;
    }
    console.log(
      `    raw matches (first level wins): L1=${l1} L2=${l2} L3=${l3} gamesWithNoEnemyRoles=${unresolved}`,
    );

    // Reported fallback levels with minSetupGames=1 to expose the matched
    // level, and with the real default (5) to show the honest L4 fallback.
    for (const minSetupGames of [1, 5]) {
      const runePicks = recommendProfileRunes(profile, championId, role, context, data, NOW_MS, {
        topPicks: 3,
        minSetupGames,
      });
      const spellPicks = recommendProfileSpells(profile, championId, role, context, data, NOW_MS, {
        topPicks: 3,
        minSetupGames,
      });
      const fmt = (p: {
        fallbackLevel: number | null;
        nEff: number;
        games: number;
        insufficientData: boolean;
      }) =>
        `L${p.fallbackLevel ?? '-'}(nEff=${p.nEff.toFixed(1)},games=${p.games}${p.insufficientData ? ',insufficient' : ''})`;
      console.log(
        `    minSetupGames=${minSetupGames} runes: ${runePicks.map(fmt).join(' | ') || '(none)'}`,
      );
      console.log(
        `    minSetupGames=${minSetupGames} spells: ${spellPicks.map(fmt).join(' | ') || '(none)'}`,
      );
    }
    console.log('');
  }
}

try {
  main();
} catch (error) {
  console.error(
    `verify-profile-matchup: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error('Hint: run `pnpm etl pull` (or `profile-sync`) so data/public is populated first.');
  process.exit(1);
}
