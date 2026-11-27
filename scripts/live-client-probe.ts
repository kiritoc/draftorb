/**
 * Live client probe (BL-040a / issue #180).
 *
 * Read-only diagnostic: dumps what the League Client (LCU) and the Live Client
 * Data API actually expose during a real game, so the BL-040a GO/NO-GO verdict
 * rests on observed fields — especially gold, items and enemy-champion data —
 * not on documentation assumptions.
 *
 * Usage (Windows, during or after a game — champ select works too):
 *   pnpm exec tsx scripts/live-client-probe.ts [--out DIR] [--lcu-lockfile PATH]
 *
 * Defaults: --out ./live-probe-output (gitignored pattern: never commit the
 * dumps). Player identifiers (summonerName, gameName, tagLine, displayName)
 * are redacted in every written file before it hits disk.
 *
 * Notes:
 *   - LCU is local HTTPS with a self-signed cert; this probe disables TLS
 *     verification for 127.0.0.1 only. It never sends credentials anywhere.
 *   - Live Client Data API is served locally on port 2999. The probe tries
 *     HTTPS first, then plain HTTP, and records which protocol answered.
 *   - The LCU lockfile lives in the League of Legends install directory
 *     (format: "name:pid:port:password:protocol"). The probe locates it via
 *     the running LeagueClientUx process; pass --lcu-lockfile (or the
 *     LCU_LOCKFILE env var) when the client is started differently. If no
 *     lockfile is found, LCU endpoints are skipped and only the Live Client
 *     Data probe runs (it needs a game).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LCU_HOST = '127.0.0.1';
const LIVE_PORT = 2999;
const DEFAULT_OUT = 'live-probe-output';

/** JSON keys whose values identify a player; always redacted in dumps. */
const REDACTED_KEYS = new Set([
  'summonerName',
  'gameName',
  'tagLine',
  'displayName',
  'riotIdGameName',
]);

export interface ProbeOptions {
  out: string;
  lcuLockfile?: string;
}

export interface LcuLockfile {
  name: string;
  pid: string;
  port: number;
  password: string;
  protocol: string;
}

export interface HttpResult {
  status: number | null;
  json: unknown;
  text: string | null;
  error?: string;
}

export interface EndpointSummary {
  status: number | null;
  error?: string;
  protocol?: 'http' | 'https';
  keys: string[] | null;
}

export function parseArgs(argv: string[]): ProbeOptions {
  const options: ProbeOptions = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--out requires a directory');
      options.out = value;
      i += 1;
    } else if (arg === '--lcu-lockfile') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--lcu-lockfile requires a path');
      options.lcuLockfile = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }
  return options;
}

/**
 * Parse an LCU lockfile body ("name:pid:port:password:protocol"). Returns null
 * when the content does not match the expected five-field format.
 */
export function parseLockfileContent(content: string): LcuLockfile | null {
  const parts = content.trim().split(':');
  if (parts.length < 5) return null;
  const [name, pid, portText, password, protocol] = parts;
  const port = Number(portText);
  if (!name || !pid || !Number.isInteger(port) || port <= 0 || !password || !protocol) {
    return null;
  }
  return { name, pid, port, password, protocol };
}

/**
 * Locate the League Client lockfile. Order: explicit --lcu-lockfile arg,
 * LCU_LOCKFILE env var, then the install directory of the running
 * LeagueClientUx/LeagueClient process (the lockfile sits next to the exe).
 */
export function findLcuLockfile(explicit?: string): string | null {
  const candidates: string[] = [];
  const fromArg = explicit ?? process.env.LCU_LOCKFILE;
  if (fromArg) candidates.push(fromArg);

  try {
    const script =
      "(Get-Process LeagueClientUx,LeagueClient -ErrorAction SilentlyContinue | " +
      'Select-Object -First 1 -ExpandProperty Path)';
    for (const shell of ['powershell', 'pwsh']) {
      try {
        const exePath = execFileSync(shell, ['-NoProfile', '-Command', script], {
          encoding: 'utf8',
          timeout: 10000,
        }).trim();
        if (exePath) candidates.push(join(dirname(exePath), 'lockfile'));
        break;
      } catch {
        /* shell unavailable or process not running — try next */
      }
    }
  } catch {
    /* process discovery is best-effort */
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readLockfile(path: string): LcuLockfile | null {
  try {
    return parseLockfileContent(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function httpJson(
  protocol: 'http' | 'https',
  { port, auth, path, timeoutMs = 4000 }: { port: number; auth?: string; path: string; timeoutMs?: number },
): Promise<HttpResult> {
  return new Promise((resolve) => {
    const base: RequestOptions = {
      host: LCU_HOST,
      port,
      path,
      method: 'GET',
      timeout: timeoutMs,
      headers: auth ? { Authorization: auth } : {},
    };
    // LCU and (per Riot's policy page) the Game Client API both use local
    // self-signed certs; verification is disabled for 127.0.0.1 only.
    const options: RequestOptions =
      protocol === 'https' ? { ...base, rejectUnauthorized: false } : base;
    const onResponse = (res: import('node:http').IncomingMessage): void => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try {
          json = JSON.parse(body);
        } catch {
          /* non-JSON body kept as text below */
        }
        resolve({
          status: res.statusCode ?? null,
          json,
          text: json === null ? body.slice(0, 500) : null,
        });
      });
    };
    const req =
      protocol === 'https' ? httpsRequest(options, onResponse) : httpRequest(options, onResponse);
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, error: 'timeout' });
    });
    req.on('error', (err) => resolve({ status: null, error: String(err) }));
    req.end();
  });
}

/** Recursively collect leaf key paths of a JSON value (depth-limited). */
export function keyPaths(value: unknown, prefix = '', depth = 0, out: string[] = []): string[] {
  if (depth > 6 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    if (first !== null && typeof first === 'object') {
      keyPaths(first, `${prefix}[0]`, depth + 1, out);
    }
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') keyPaths(v, p, depth + 1, out);
    else out.push(p);
  }
  return out;
}

/**
 * Deep-clone a JSON value with player-identifying fields replaced by
 * '[redacted]', so dumps can be shared on the public issue safely.
 */
export function redactPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPersonalData);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? '[redacted]' : redactPersonalData(v);
    }
    return out;
  }
  return value;
}

const LCU_ENDPOINTS = [
  '/lol-gameflow/v1/gameflow-phase',
  '/lol-champ-select/v1/session',
  '/lol-champ-select/v1/current-champion',
  '/lol-game-data/assets',
];

const LIVE_ENDPOINTS = [
  '/liveclientdata/allgamedata',
  '/liveclientdata/activeplayer',
  '/liveclientdata/eventdata',
  '/liveclientdata/playerlist',
];

function writeDump(
  out: string,
  filename: string,
  payload: unknown,
): void {
  writeFileSync(
    join(out, filename),
    JSON.stringify(redactPersonalData(payload), null, 2),
  );
}

function summarize(
  res: HttpResult & { protocol?: 'http' | 'https' },
): EndpointSummary {
  return {
    status: res.status,
    error: res.error,
    protocol: res.protocol,
    keys: res.json ? keyPaths(res.json).slice(0, 200) : null,
  };
}

/** Live Client Data: try HTTPS first, fall back to HTTP; record the winner. */
async function probeLive(path: string): Promise<HttpResult & { protocol?: 'http' | 'https' }> {
  const httpsRes = await httpJson('https', { port: LIVE_PORT, path });
  if (httpsRes.status !== null) return { ...httpsRes, protocol: 'https' };
  const httpRes = await httpJson('http', { port: LIVE_PORT, path });
  return { ...httpRes, protocol: 'http' };
}

async function main(): Promise<void> {
  const { out, lcuLockfile } = parseArgs(process.argv.slice(2));
  mkdirSync(out, { recursive: true });

  const lockfilePath = findLcuLockfile(lcuLockfile);
  const lockfile = lockfilePath ? readLockfile(lockfilePath) : null;
  const summary: { checkedAt: string; lcu: Record<string, EndpointSummary>; live: Record<string, EndpointSummary> } = {
    checkedAt: new Date().toISOString(),
    lcu: {},
    live: {},
  };

  if (!lockfilePath) {
    console.log(
      'LCU lockfile not found — is the League Client running? ' +
        'Pass --lcu-lockfile <path> if it lives elsewhere. ' +
        'Skipping LCU endpoints; probing Live Client Data anyway.',
    );
  } else if (!lockfile) {
    console.log(
      `LCU lockfile at ${lockfilePath} could not be parsed ` +
        '(expected "name:pid:port:password:protocol"). Skipping LCU endpoints.',
    );
  } else {
    console.log(`LCU lockfile: ${lockfilePath} (protocol: ${lockfile.protocol})`);
    const auth = 'Basic ' + Buffer.from(`riot:${lockfile.password}`).toString('base64');
    const lcuProtocol = lockfile.protocol === 'http' ? 'http' : 'https';
    for (const path of LCU_ENDPOINTS) {
      const res = await httpJson(lcuProtocol, {
        port: lockfile.port,
        auth,
        path,
      });
      const name = path.replaceAll('/', '_');
      writeDump(out, `lcu${name}.json`, res.json ?? res.text ?? res.error ?? 'no data');
      summary.lcu[path] = summarize({ ...res, protocol: lcuProtocol });
      console.log(`LCU ${path} -> ${res.status ?? res.error}`);
    }
  }

  for (const path of LIVE_ENDPOINTS) {
    const res = await probeLive(path);
    const name = path.replace('/liveclientdata/', '');
    writeDump(out, `live-${name}.json`, res.json ?? res.text ?? res.error ?? 'no data');
    summary.live[path] = summarize(res);
    console.log(`LIVE ${path} -> ${res.status ?? res.error} (${res.protocol})`);
  }

  writeFileSync(join(out, 'summary.json'), JSON.stringify(redactPersonalData(summary), null, 2));
  console.log(
    `\nDumps + summary written to ${out}/ — attach summary.json and the live-*.json files to issue #180.`,
  );
  console.log(
    'Player identifiers (summonerName/gameName/tagLine/displayName) are already redacted; ' +
      'still do not commit the dumps.',
  );
}

const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
