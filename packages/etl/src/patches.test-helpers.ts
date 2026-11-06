import type Database from 'better-sqlite3';

import { comparePatches } from './matches-store';

/**
 * Test helper: (re)builds the `patches` table for fixture labels.
 *
 * Labels are merged with the existing rows, sorted with `comparePatches`
 * (fixture ordering only — production ordering comes from Data Dragon
 * `versions.json`, never from version-string compares) and renumbered
 * contiguously from 1. `matches`/`match_rejects` store labels, not indices,
 * so renumbering is safe here.
 */
export function seedPatches(db: Database.Database, labels: readonly string[]): void {
  const existing = (
    db.prepare('SELECT version_label FROM patches').all() as Array<{ version_label: string }>
  ).map((row) => row.version_label);
  const all = [...new Set([...existing, ...labels])].sort(comparePatches);
  const write = db.transaction(() => {
    db.prepare('DELETE FROM patches').run();
    const insert = db.prepare('INSERT INTO patches (patch_index, version_label) VALUES (?, ?)');
    all.forEach((label, index) => {
      insert.run(index + 1, label);
    });
  });
  write.immediate();
}
