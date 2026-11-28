import { describe, expect, it } from 'vitest';
import { defaultRole, roleAvailability } from './roles';

describe('roleAvailability', () => {
  it('enables only SUPPORT by default', () => {
    const a = roleAvailability();
    expect(
      Object.entries(a)
        .filter(([, v]) => v.enabled)
        .map(([k]) => k),
    ).toEqual(['SUPPORT']);
  });

  it('explains disabled roles', () => {
    const a = roleAvailability();
    expect(a.TOP.reason).toBe('Not enough champion data for this role');
    expect(a.JUNGLE.reason).toBe('Not enough champion data for this role');
    expect(a.ADC.reason).toBe('Not enough champion data for this role');
    expect(a.MID.reason).toBe('Not enough champion data for this role');
    expect(a.SUPPORT.reason).toBeUndefined();
  });

  it('enabling TOP through the argument works', () => {
    const a = roleAvailability(['SUPPORT', 'TOP']);
    expect(a.TOP).toEqual({ enabled: true });
    expect(a.JUNGLE.enabled).toBe(false);
  });
});

describe('defaultRole (BL-055)', () => {
  it('returns SUPPORT by default', () => {
    expect(defaultRole()).toBe('SUPPORT');
    expect(defaultRole(['SUPPORT', 'TOP'])).toBe('SUPPORT');
  });

  it('returns the first eligible role in ROLE_ORDER when SUPPORT is disabled', () => {
    expect(defaultRole(['JUNGLE', 'TOP'])).toBe('TOP');
    expect(defaultRole(['MID', 'ADC'])).toBe('ADC');
  });

  it('falls back to SUPPORT when no role is eligible', () => {
    expect(defaultRole([])).toBe('SUPPORT');
  });
});
