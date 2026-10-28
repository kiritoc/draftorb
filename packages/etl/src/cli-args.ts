import { rankSchema } from '@draftorb/shared';

export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  AUTH: 3,
} as const;

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT.FAILURE) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super(message, EXIT.USAGE);
    this.name = 'UsageError';
  }
}

const RANK_OPTIONS = rankSchema.options;

/** Parses a string as a strictly positive integer (> 0). Accepts only /^\d+$/ values that are safe integers. */
export function parseStrictPositiveInt(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === '' || value.trim() !== value) {
    throw new UsageError(`Invalid ${flag} "${value}". Expected a positive integer.`);
  }
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`Invalid ${flag} "${value}". Expected a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new UsageError(`Invalid ${flag} "${value}". Expected a positive integer.`);
  }
  return parsed;
}

/** Parses a comma-delimited tier list. Trims, upper-cases, deduplicates; every tier must be in rankSchema.options. */
export function parseTierList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === '') {
    throw new UsageError(`Invalid tiers "${value}". Expected tier names like "EMERALD,DIAMOND".`);
  }
  const parts = value.split(',');
  for (const part of parts) {
    if (part.trim().length === 0) {
      throw new UsageError(`Invalid tiers "${value}". Expected tier names like "EMERALD,DIAMOND".`);
    }
  }
  const tiers = parts.map((tier) => tier.trim().toUpperCase());

  const uniqueTiers: string[] = [];
  for (const tier of tiers) {
    if (!RANK_OPTIONS.includes(tier as (typeof RANK_OPTIONS)[number])) {
      throw new UsageError(`Invalid tier "${tier}". Expected one of: ${RANK_OPTIONS.join(', ')}`);
    }
    if (!uniqueTiers.includes(tier)) {
      uniqueTiers.push(tier);
    }
  }
  return uniqueTiers.length > 0 ? uniqueTiers : undefined;
}

/** Parses a comma-delimited quota list (e.g. "EMERALD:200,DIAMOND:0"). Nonnegative integers; every tier must be in rankSchema.options. */
export function parseQuotaList(value: string | undefined): Record<string, number> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result: Record<string, number> = {};
  const entries = value.split(',');
  for (const rawPair of entries) {
    const pair = rawPair.trim();
    const parts = pair.split(':');
    if (parts.length !== 2) {
      throw new UsageError(
        `Invalid quota entry "${pair}". Expected a nonnegative integer in a format like "EMERALD:200,DIAMOND:200".`,
      );
    }
    const tierRaw = parts[0];
    const limitRaw = parts[1];
    if (tierRaw === undefined || limitRaw === undefined) {
      throw new UsageError(
        `Invalid quota entry "${pair}". Expected a nonnegative integer in a format like "EMERALD:200,DIAMOND:200".`,
      );
    }
    const tier = tierRaw.trim().toUpperCase();
    const limit = limitRaw.trim();
    if (!RANK_OPTIONS.includes(tier as (typeof RANK_OPTIONS)[number])) {
      throw new UsageError(
        `Invalid quota entry "${pair}". Expected a nonnegative integer in a format like "EMERALD:200,DIAMOND:200".`,
      );
    }
    if (!/^\d+$/.test(limit)) {
      throw new UsageError(
        `Invalid quota entry "${pair}". Expected a nonnegative integer in a format like "EMERALD:200,DIAMOND:200".`,
      );
    }
    const quota = Number(limit);
    if (!Number.isSafeInteger(quota) || quota < 0) {
      throw new UsageError(
        `Invalid quota entry "${pair}". Expected a nonnegative integer in a format like "EMERALD:200,DIAMOND:200".`,
      );
    }
    result[tier] = quota;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
