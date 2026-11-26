import {
  POOL_CONFIG_MAX_PER_ROLE,
  POOL_CONFIG_SCHEMA_VERSION,
  poolConfigSchema,
  roleSchema,
  type PoolConfig,
  type PoolConfigEntry,
  type Role,
} from '@draftorb/shared';
import { strings } from '../strings';

const ROLES: readonly Role[] = roleSchema.options;

export function emptyPool(): PoolConfig {
  return { schemaVersion: POOL_CONFIG_SCHEMA_VERSION, pools: {} };
}

function withRole(pool: PoolConfig, role: Role, entries: PoolConfigEntry[]): PoolConfig {
  const pools = Object.fromEntries(
    Object.entries(pool.pools).filter(([key]) => key !== role),
  ) as PoolConfig['pools'];
  return { ...pool, pools: entries.length === 0 ? pools : { ...pools, [role]: entries } };
}

/** Champion x roles editor primitive: the champion ends up in exactly `roles`. */
export function setChampionRoles(
  pool: PoolConfig,
  championId: number,
  roles: readonly Role[],
  name?: string,
): { pool: PoolConfig; rejectedRoles: Role[] } {
  let next = pool;
  const rejectedRoles: Role[] = [];
  for (const role of ROLES) {
    const entries = next.pools[role] ?? [];
    const present = entries.some((e) => e.championId === championId);
    if (!roles.includes(role)) {
      if (present)
        next = withRole(
          next,
          role,
          entries.filter((e) => e.championId !== championId),
        );
    } else if (!present) {
      if (entries.length >= POOL_CONFIG_MAX_PER_ROLE) rejectedRoles.push(role);
      else {
        const entry: PoolConfigEntry = name === undefined ? { championId } : { championId, name };
        next = withRole(next, role, [...entries, entry]);
      }
    }
  }
  return { pool: next, rejectedRoles };
}

/** Roles a champion currently occupies, in `roleSchema` order (editor checkboxes). */
export function championPoolRoles(pool: PoolConfig, championId: number): Role[] {
  return ROLES.filter((role) =>
    (pool.pools[role] ?? []).some((entry) => entry.championId === championId),
  );
}

/** Per-role champion-id sets; order, names and empty roles are ignored (SPECS §19.3). */
export function poolDiffers(a: PoolConfig, b: PoolConfig): boolean {
  return ROLES.some((role) => {
    const left = new Set((a.pools[role] ?? []).map((e) => e.championId));
    const right = new Set((b.pools[role] ?? []).map((e) => e.championId));
    return left.size !== right.size || [...left].some((id) => !right.has(id));
  });
}

export function serializePoolConfig(pool: PoolConfig): string {
  const pools: PoolConfig['pools'] = {};
  for (const role of ROLES) {
    const entries = pool.pools[role];
    if (entries !== undefined && entries.length > 0) pools[role] = entries;
  }
  return `${JSON.stringify({ schemaVersion: pool.schemaVersion, pools }, null, 2)}\n`;
}

/** `null` = missing file (normal). Never throws. */
export function parsePoolConfig(raw: string | null): { pool: PoolConfig; notice?: string } {
  if (raw === null) return { pool: emptyPool() };
  try {
    const result = poolConfigSchema.safeParse(JSON.parse(raw));
    if (result.success) return { pool: result.data };
  } catch {
    // fall through to the notice
  }
  return { pool: emptyPool(), notice: strings.poolReset };
}

/** Removes ids absent from the catalogue (SPECS §2.1); `dropped` lists each id once. */
export function dropUnknownChampions(
  pool: PoolConfig,
  knownIds: ReadonlySet<number>,
): { pool: PoolConfig; dropped: number[] } {
  const dropped = new Set<number>();
  let next = pool;
  for (const role of ROLES) {
    const entries = next.pools[role] ?? [];
    const kept = entries.filter((e) => knownIds.has(e.championId));
    if (kept.length !== entries.length) {
      for (const e of entries) if (!knownIds.has(e.championId)) dropped.add(e.championId);
      next = withRole(next, role, kept);
    }
  }
  return { pool: next, dropped: [...dropped] };
}
