import { describe, expect, it } from 'vitest';

import { UsageError, parseQuotaList, parseStrictPositiveInt, parseTierList } from './cli-args';

describe('parseStrictPositiveInt', () => {
  it("accepts '20' -> 20", () => {
    expect(parseStrictPositiveInt('20', '--per-player')).toBe(20);
  });

  it("rejects '20abc' with UsageError", () => {
    expect(() => parseStrictPositiveInt('20abc', '--per-player')).toThrow(UsageError);
  });

  it("rejects '1.5' with UsageError", () => {
    expect(() => parseStrictPositiveInt('1.5', '--limit')).toThrow(UsageError);
  });

  it("rejects '1e3' with UsageError", () => {
    expect(() => parseStrictPositiveInt('1e3', '--queue')).toThrow(UsageError);
  });

  it("rejects '0' with UsageError", () => {
    expect(() => parseStrictPositiveInt('0', '--per-player')).toThrow(UsageError);
  });

  it("rejects '-1' with UsageError", () => {
    expect(() => parseStrictPositiveInt('-1', '--per-player')).toThrow(UsageError);
  });

  it("rejects '' with UsageError", () => {
    expect(() => parseStrictPositiveInt('', '--per-player')).toThrow(UsageError);
  });

  it("rejects ' 20' with UsageError", () => {
    expect(() => parseStrictPositiveInt(' 20', '--per-player')).toThrow(UsageError);
  });

  it('returns undefined when value is undefined', () => {
    expect(parseStrictPositiveInt(undefined, '--per-player')).toBeUndefined();
  });
});

describe('parseTierList', () => {
  it("accepts 'diamond, MASTER' -> ['DIAMOND', 'MASTER']", () => {
    expect(parseTierList('diamond, MASTER')).toEqual(['DIAMOND', 'MASTER']);
  });

  it("rejects 'DIAMND' with UsageError", () => {
    expect(() => parseTierList('DIAMND')).toThrow(UsageError);
  });

  it('returns undefined when value is undefined', () => {
    expect(parseTierList(undefined)).toBeUndefined();
  });

  it('deduplicates tiers', () => {
    expect(parseTierList('DIAMOND,diamond,MASTER')).toEqual(['DIAMOND', 'MASTER']);
  });
});

describe('parseQuotaList', () => {
  it("accepts 'EMERALD:200,DIAMOND:0'", () => {
    expect(parseQuotaList('EMERALD:200,DIAMOND:0')).toEqual({ EMERALD: 200, DIAMOND: 0 });
  });

  it("rejects 'DIAMND:100' with UsageError", () => {
    expect(() => parseQuotaList('DIAMND:100')).toThrow(UsageError);
  });

  it("rejects 'EMERALD:20x' with UsageError", () => {
    expect(() => parseQuotaList('EMERALD:20x')).toThrow(UsageError);
  });

  it("rejects 'EMERALD' with UsageError", () => {
    expect(() => parseQuotaList('EMERALD')).toThrow(UsageError);
  });

  it("rejects 'EMERALD:1:2' with UsageError", () => {
    expect(() => parseQuotaList('EMERALD:1:2')).toThrow(UsageError);
  });

  it('returns undefined when value is undefined', () => {
    expect(parseQuotaList(undefined)).toBeUndefined();
  });
});
