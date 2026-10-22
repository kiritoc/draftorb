import fs from 'node:fs/promises';
import path from 'node:path';

import { championTagsMapSchema, type ChampionsMap, type ChampionTagsMap } from '@draftorb/shared';

export interface ChampionCoverageItem {
  id: number;
  name: string;
  roles: string[];
}

export interface ChampionTagsCoverageReport {
  totalChampions: number;
  taggedCount: number;
  totalSupportCount: number;
  taggedSupportCount: number;
  supportCoveragePercent: number;
  overallCoveragePercent: number;
  missingSupports: ChampionCoverageItem[];
  flexPicks: ChampionCoverageItem[];
  untaggedChampions: ChampionCoverageItem[];
}

export interface ValidateTagsOptions {
  tagsFilePath?: string;
  championsFilePath?: string;
  repoRoot?: string;
}

export interface ValidateTagsResult {
  tags: ChampionTagsMap;
  coverage: ChampionTagsCoverageReport;
  isValid: boolean;
  errors: string[];
}

/**
 * Pure evaluation function that calculates coverage of champion tags against
 * the champion catalog, highlighting required support coverage, flex picks,
 * and untagged champions.
 */
export function evaluateChampionTagsCoverage(
  tags: ChampionTagsMap,
  champions: ChampionsMap,
): ChampionTagsCoverageReport {
  const allChampions = Object.values(champions);
  const totalChampions = allChampions.length;
  const taggedKeys = new Set(Object.keys(tags));

  const missingSupports: ChampionCoverageItem[] = [];
  const flexPicks: ChampionCoverageItem[] = [];
  const untaggedChampions: ChampionCoverageItem[] = [];

  let totalSupportCount = 0;
  let taggedSupportCount = 0;

  for (const champion of allChampions) {
    const isSupport = champion.roles.includes('SUPPORT');
    const isTagged = taggedKeys.has(String(champion.id));

    if (isSupport) {
      totalSupportCount++;
      if (isTagged) {
        taggedSupportCount++;
      } else {
        missingSupports.push({
          id: champion.id,
          name: champion.name,
          roles: champion.roles,
        });
      }
    }

    if (!isTagged) {
      untaggedChampions.push({
        id: champion.id,
        name: champion.name,
        roles: champion.roles,
      });
    } else if (!isSupport) {
      flexPicks.push({
        id: champion.id,
        name: champion.name,
        roles: champion.roles,
      });
    }
  }

  const supportCoveragePercent =
    totalSupportCount > 0
      ? Number(((taggedSupportCount / totalSupportCount) * 100).toFixed(1))
      : 100;

  const overallCoveragePercent =
    totalChampions > 0 ? Number(((Object.keys(tags).length / totalChampions) * 100).toFixed(1)) : 0;

  return {
    totalChampions,
    taggedCount: Object.keys(tags).length,
    totalSupportCount,
    taggedSupportCount,
    supportCoveragePercent,
    overallCoveragePercent,
    missingSupports,
    flexPicks,
    untaggedChampions,
  };
}

/**
 * Formats a ChampionTagsCoverageReport into a readable multi-line summary string.
 */
export function formatCoverageReport(coverage: ChampionTagsCoverageReport): string {
  const lines: string[] = [];

  lines.push('====================================================');
  lines.push('            CHAMPION TAGS COVERAGE REPORT           ');
  lines.push('====================================================');
  lines.push(`Total champions in catalog: ${coverage.totalChampions}`);
  lines.push(
    `Total tagged champions:     ${coverage.taggedCount} (${coverage.overallCoveragePercent}%)`,
  );
  lines.push(
    `Support role champions:     ${coverage.taggedSupportCount}/${coverage.totalSupportCount} (${coverage.supportCoveragePercent}%)`,
  );
  lines.push(`Flex pick champions tagged: ${coverage.flexPicks.length}`);
  lines.push('----------------------------------------------------');

  if (coverage.missingSupports.length > 0) {
    lines.push(`MISSING SUPPORTS (${coverage.missingSupports.length}):`);
    for (const sup of coverage.missingSupports) {
      lines.push(`  - [ID: ${sup.id}] ${sup.name} (roles: ${sup.roles.join(', ')})`);
    }
    lines.push('----------------------------------------------------');
  } else {
    lines.push('All required support champions are tagged! (100% support coverage)');
    lines.push('----------------------------------------------------');
  }

  if (coverage.flexPicks.length > 0) {
    lines.push(`FLEX PICKS TAGGED (${coverage.flexPicks.length}):`);
    const flexNames = coverage.flexPicks.map((f) => `${f.name} [${f.id}]`).join(', ');
    lines.push(`  ${flexNames}`);
    lines.push('----------------------------------------------------');
  }

  lines.push(`UNTAGGED CHAMPIONS (${coverage.untaggedChampions.length}):`);
  const untaggedSample = coverage.untaggedChampions.map((u) => u.name).join(', ');
  lines.push(`  ${untaggedSample}`);
  lines.push('====================================================');

  return lines.join('\n');
}

/**
 * Discovers the latest champions.json file in data/public/<patch>/.
 */
export async function findLatestChampionsPath(repoRoot: string): Promise<string> {
  const publicDir = path.join(repoRoot, 'data', 'public');
  const entries = await fs.readdir(publicDir, { withFileTypes: true });
  const patchDirs = entries
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const [majA, minA] = a.split('.').map(Number);
      const [majB, minB] = b.split('.').map(Number);
      if (majA !== majB) return (majB ?? 0) - (majA ?? 0);
      return (minB ?? 0) - (minA ?? 0);
    });

  for (const patch of patchDirs) {
    const candidatePath = path.join(publicDir, patch, 'champions.json');
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      // Try next
    }
  }

  throw new Error(`No champions.json found in any patch directory inside ${publicDir}`);
}

/**
 * Loads and validates data/manual/champion-tags.json, evaluates coverage against
 * champions.json, and returns structured validation results and errors.
 */
export async function validateChampionTagsFile(
  options: ValidateTagsOptions = {},
): Promise<ValidateTagsResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const tagsFilePath =
    options.tagsFilePath ?? path.join(repoRoot, 'data', 'manual', 'champion-tags.json');
  const championsFilePath = options.championsFilePath ?? (await findLatestChampionsPath(repoRoot));

  const errors: string[] = [];

  // Read tags JSON
  let rawTagsContent: string;
  try {
    rawTagsContent = await fs.readFile(tagsFilePath, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read tags file at ${tagsFilePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsedRawTags: unknown;
  try {
    parsedRawTags = JSON.parse(rawTagsContent);
  } catch (err) {
    throw new Error(
      `Tags file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Schema validation
  const parseResult = championTagsMapSchema.safeParse(parsedRawTags);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`Schema error at ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  const tags: ChampionTagsMap = parseResult.success ? parseResult.data : {};

  // Read champions catalog
  let rawChampionsContent: string;
  try {
    rawChampionsContent = await fs.readFile(championsFilePath, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read champions file at ${championsFilePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsedChampions = JSON.parse(rawChampionsContent) as ChampionsMap;
  const coverage = evaluateChampionTagsCoverage(tags, parsedChampions);

  if (coverage.missingSupports.length > 0) {
    for (const missing of coverage.missingSupports) {
      errors.push(`Missing tag for required support champion: ${missing.name} (ID: ${missing.id})`);
    }
  }

  return {
    tags,
    coverage,
    isValid: errors.length === 0,
    errors,
  };
}
