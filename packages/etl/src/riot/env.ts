/**
 * Lightweight .env loader helper for ETL scripts.
 *
 * Reads variables without adding heavy runtime dependencies.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Attempts to load environment variables from a .env file if key is missing.
 */
export function loadEnv(envPath?: string): void {
  const candidatePaths = envPath
    ? [envPath]
    : [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];

  for (const path of candidatePaths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        parseAndApplyEnv(content);
        return;
      } catch {
        // Silently skip if unreadable
      }
    }
  }
}

/**
 * Parses simple KEY=VALUE text and assigns unset variables to process.env.
 */
export function parseAndApplyEnv(content: string): void {
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    let val = trimmed.slice(equalIndex + 1).trim();

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
