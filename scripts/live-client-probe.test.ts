/**
 * Live client probe unit tests (BL-040a): lockfile parsing, argument parsing
 * and personal-data redaction. The probe itself needs a running League client
 * and is exercised manually on Windows; these tests cover the pure helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  keyPaths,
  parseArgs,
  parseLockfileContent,
  redactPersonalData,
} from './live-client-probe.js';

describe('parseLockfileContent', () => {
  it('parses the five-field LCU lockfile format', () => {
    expect(parseLockfileContent('LeagueClient:1234:54321:hunter2:https\n')).toEqual({
      name: 'LeagueClient',
      pid: '1234',
      port: 54321,
      password: 'hunter2',
      protocol: 'https',
    });
  });

  it('rejects malformed content', () => {
    expect(parseLockfileContent('')).toBeNull();
    expect(parseLockfileContent('name:password:port')).toBeNull();
    expect(parseLockfileContent('name:pid:notaport:pw:https')).toBeNull();
    expect(parseLockfileContent('name:pid:0:pw:https')).toBeNull();
    expect(parseLockfileContent('name:pid:8080::https')).toBeNull();
  });
});

describe('parseArgs', () => {
  it('defaults the output directory', () => {
    expect(parseArgs([])).toEqual({ out: 'live-probe-output' });
  });

  it('accepts --out and --lcu-lockfile', () => {
    expect(parseArgs(['--out', 'tmp', '--lcu-lockfile', 'C:\\x\\lockfile'])).toEqual({
      out: 'tmp',
      lcuLockfile: 'C:\\x\\lockfile',
    });
  });

  it('rejects unknown or incomplete arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow('Unknown argument');
    expect(() => parseArgs(['--out'])).toThrow('--out requires');
    expect(() => parseArgs(['--lcu-lockfile'])).toThrow('--lcu-lockfile requires');
  });
});

describe('redactPersonalData', () => {
  it('redacts player identifiers at any depth', () => {
    const input = {
      summonerName: 'KiriToc',
      gameName: 'Kiri',
      tagLine: 'Toc',
      displayName: 'Kiri#Toc',
      riotIdGameName: 'KiriToc',
      champion: { name: 'Lux', stats: { currentGold: 1234 } },
      players: [{ summonerName: 'Other', riotId: 'NA1_abc' }],
    };
    const out = redactPersonalData(input) as Record<string, unknown>;
    expect(out.summonerName).toBe('[redacted]');
    expect(out.gameName).toBe('[redacted]');
    expect(out.tagLine).toBe('[redacted]');
    expect(out.displayName).toBe('[redacted]');
    expect(out.riotIdGameName).toBe('[redacted]');
    expect(out.champion).toEqual({ name: 'Lux', stats: { currentGold: 1234 } });
    expect((out.players as Record<string, unknown>[])[0]).toEqual({
      summonerName: '[redacted]',
      riotId: 'NA1_abc',
    });
    // input is not mutated
    expect(input.summonerName).toBe('KiriToc');
  });

  it('passes through primitives and null', () => {
    expect(redactPersonalData('x')).toBe('x');
    expect(redactPersonalData(null)).toBeNull();
    expect(redactPersonalData(42)).toBe(42);
  });
});

describe('keyPaths', () => {
  it('lists leaf key paths of nested JSON', () => {
    expect(keyPaths({ a: { b: [{ d: 1 }] }, c: 'x' })).toEqual(['a.b[0].d', 'c']);
  });
});
