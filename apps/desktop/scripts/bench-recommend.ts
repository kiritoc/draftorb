#!/usr/bin/env node
/**
 * BL-022 engine-latency bench: `recommend()` on a full 10-slot + bans draft
 * against the local `data/` export (SPECS §10 budget: < 50 ms).
 *
 * Usage: pnpm --filter @draftorb/desktop bench:recommend [-- --runs 200]
 * Reads `<repo>/data/public` + `<repo>/data/manual` (generated, gitignored);
 * override with --data <dir> pointing at a `data/` folder.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { recommend } from '@draftorb/engine';
import {
  championTagsMapSchema,
  championsMapSchema,
  draftInputSchema,
  latestSchema,
  manifestSchema,
  roleSchema,
  type Role,
} from '@draftorb/shared';

import { createRecommendData } from '../ui/src/data/export-data';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const RUNS = Number(opt('--runs', '200'));
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error('--runs must be a positive integer');
  process.exit(1);
}
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)), '..', '..');
const DATA = resolve(opt('--data', join(repoRoot, 'data')));
const roleArg = opt('--role', 'SUPPORT');
const roleParsed = roleSchema.safeParse(roleArg);
if (!roleParsed.success) {
  console.error(`--role must be one of: ${roleSchema.options.join(', ')}`);
  process.exit(1);
}
const ROLE: Role = roleParsed.data;

const read = (...segments: string[]) =>
  JSON.parse(readFileSync(join(DATA, ...segments), 'utf8'));

const latest = latestSchema.parse(read('public', 'latest.json'));
const manifest = manifestSchema.parse(read('public', ...latest.manifest.split('/')));
const files: Record<string, unknown> = {};
for (const file of manifest.files) {
  if (file.path.startsWith('/')) continue;
  files[file.path] = read('public', latest.patch, ...file.path.split('/'));
}
const champions = Object.values(championsMapSchema.parse(files['champions.json']));
const tags = championTagsMapSchema.parse(read('manual', 'champion-tags.json'));
const data = createRecommendData(files, champions, tags, ROLE);
const ids = champions.map((c) => c.id);

const input = draftInputSchema.parse({
  userRank: 'DIAMOND',
  userRole: ROLE,
  allies: [
    { championId: ids[10] },
    { championId: ids[20], role: 'TOP' },
    { championId: ids[30] },
    { championId: ids[40] },
  ],
  enemies: [
    { championId: ids[50] },
    { championId: ids[60] },
    { championId: ids[70] },
    { championId: ids[80] },
    { championId: ids[90] },
  ],
  blindPick: false,
  bans: ids.slice(100, 110),
});

for (let i = 0; i < 20; i += 1) recommend(input, data);
const times: number[] = [];
for (let i = 0; i < RUNS; i += 1) {
  const t0 = performance.now();
  recommend(input, data);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const pick = (q: number) => times[Math.floor(times.length * q)] ?? 0;
console.log(
  `recommend() full draft (${ROLE}): n=${times.length} ` +
    `p50=${pick(0.5).toFixed(2)}ms p95=${pick(0.95).toFixed(2)}ms ` +
    `max=${times[times.length - 1]?.toFixed(2)}ms champions=${champions.length}`,
);
