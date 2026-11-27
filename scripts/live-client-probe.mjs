#!/usr/bin/env node
/**
 * Live client probe (BL-040a / issue #180).
 *
 * Read-only diagnostic: dumps what the League Client (LCU) and the Live Client
 * Data API actually expose during a real game, so the BL-040a GO/NO-GO verdict
 * rests on observed fields — especially gold, items and enemy-champion data —
 * not on documentation assumptions.
 *
 * Usage (Windows, during or after a game — champ select works too):
 *   node scripts/live-client-probe.mjs [--out DIR]
 *
 * Defaults: --out ./live-probe-output (gitignored pattern: never commit the
 * dumps, they can contain your summoner name).
 *
 * Notes:
 *   - LCU is local HTTPS with a self-signed cert; this probe disables TLS
 *     verification for 127.0.0.1 only. It never sends credentials anywhere.
 *   - Live Client Data API is plain HTTP on the same port, no auth.
 *   - The LCU lockfile lives at
 *     %PROGRAMDATA%\\Riot Games\\Riot Client\\Config\\lockfile
 *     (format: "name:password:port"). If the client is closed, LCU endpoints
 *     are skipped and only the Live Client Data probe runs (it needs a game).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

const LCU_HOST = '127.0.0.1';
const DEFAULT_OUT = 'live-probe-output';

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') options.out = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

/** Read the LCU lockfile; returns { port, password } or null when absent. */
function readLockfile() {
  const programData = process.env.PROGRAMDATA ?? 'C:\\ProgramData';
  const lockfilePath = join(programData, 'Riot Games', 'Riot Client', 'Config', 'lockfile');
  if (!existsSync(lockfilePath)) return null;
  const [name, password, port] = execFileSync('cmd', ['/c', 'type', lockfilePath])
    .toString()
    .trim()
    .split(':');
  if (!password || !port) return null;
  return { port: Number(port), password, name };
}

function httpJson(protocol, { port, auth, path, timeoutMs = 4000 }) {
  return new Promise((resolve) => {
    const options = {
      host: LCU_HOST,
      port,
      path,
      method: 'GET',
      timeout: timeoutMs,
      headers: auth ? { Authorization: auth } : {},
    };
    const req = (protocol === 'https' ? httpsRequest : httpRequest)(
      { ...options, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* non-JSON body kept as text below */
          }
          resolve({
            status: res.statusCode,
            json,
            text: json === null ? body.slice(0, 500) : null,
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, error: 'timeout' });
    });
    req.on('error', (err) => resolve({ status: null, error: String(err) }));
    req.end();
  });
}

/** Recursively collect leaf key paths of a JSON value (depth-limited). */
function keyPaths(value, prefix = '', depth = 0, out = []) {
  if (depth > 6 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object') {
      keyPaths(value[0], `${prefix}[0]`, depth + 1, out);
    }
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') keyPaths(v, p, depth + 1, out);
    else out.push(p);
  }
  return out;
}

const LCU_ENDPOINTS = [
  '/lol-gameflow/v1/gameflow-phase',
  '/lol-champ-select/v1/session',
  '/lol-champ-select/v1/current-champion',
  '/lol-game-data/assets',
];

const LIVE_ENDPOINTS = [
  '/liveclientdata/allgame',
  '/liveclientdata/activeplayer',
  '/liveclientdata/eventdata',
  '/liveclientdata/playerlist',
];

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  mkdirSync(out, { recursive: true });

  const lockfile = readLockfile();
  const summary = { checkedAt: new Date().toISOString(), lcu: {}, live: {} };

  if (!lockfile) {
    console.log(
      'LCU lockfile not found — is the League Client running on Windows? ' +
        'Skipping LCU endpoints; probing Live Client Data anyway.',
    );
  } else {
    const auth = 'Basic ' + Buffer.from(`riot:${lockfile.password}`).toString('base64');
    for (const path of LCU_ENDPOINTS) {
      const res = await httpJson('https', {
        port: lockfile.port,
        auth,
        path,
      });
      const name = path.replaceAll('/', '_');
      writeFileSync(
        join(out, `lcu${name}.json`),
        JSON.stringify(res.json ?? res.text ?? res.error, null, 2),
      );
      summary.lcu[path] = {
        status: res.status,
        error: res.error,
        keys: res.json ? keyPaths(res.json).slice(0, 200) : null,
      };
      console.log(`LCU ${path} -> ${res.status ?? res.error}`);
    }
  }

  for (const path of LIVE_ENDPOINTS) {
    const res = await httpJson('http', { port: 2999, path });
    const name = path.replace('/liveclientdata/', '');
    writeFileSync(
      join(out, `live-${name}.json`),
      JSON.stringify(res.json ?? res.text ?? res.error, null, 2),
    );
    summary.live[path] = {
      status: res.status,
      error: res.error,
      keys: res.json ? keyPaths(res.json).slice(0, 200) : null,
    };
    console.log(`LIVE ${path} -> ${res.status ?? res.error}`);
  }

  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(
    `\nDumps + summary written to ${out}/ — attach summary.json and the live-*.json files to issue #180.`,
  );
  console.log('Reminder: dumps can contain your summoner name; do not commit them.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
