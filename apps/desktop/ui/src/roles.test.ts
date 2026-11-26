import { describe, expect, it } from 'vitest';
import { roleAvailability } from './roles';

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
