import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { createTarGz } from './tar-create';
import { parseTar } from './tar-extract';

describe('createTarGz', () => {
  it('round-trips through parseTar', () => {
    const entries = [
      { name: 'public/16.22/baseline.json', data: Buffer.from('{"a":1}') },
      { name: 'public/latest.json', data: Buffer.from('{}') },
      { name: 'public/profiles/index.json', data: Buffer.alloc(600, 0x61) },
    ];
    const parsed = parseTar(gunzipSync(createTarGz(entries)));
    expect(parsed.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i += 1) {
      expect(parsed[i]?.data.equals(entries[i]!.data)).toBe(true);
      expect(parsed[i]?.type).toBe('0');
    }
  });

  it('handles names longer than 100 chars via ustar prefix', () => {
    const long = `public/${'a'.repeat(60)}/${'b'.repeat(60)}/file.json`;
    const parsed = parseTar(gunzipSync(createTarGz([{ name: long, data: Buffer.from('x') }])));
    expect(parsed[0]?.name).toBe(long);
  });

  it('rejects unsafe names', () => {
    expect(() => createTarGz([{ name: '../evil', data: Buffer.alloc(0) }])).toThrow(/Unsafe/);
    expect(() => createTarGz([{ name: '/abs', data: Buffer.alloc(0) }])).toThrow(/Unsafe/);
  });
});
