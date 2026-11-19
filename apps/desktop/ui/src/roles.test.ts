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
    expect(a.TOP.reason).toBe('Needs TOP/JUNGLE data (BL-011)');
    expect(a.JUNGLE.reason).toBe('Needs TOP/JUNGLE data (BL-011)');
    expect(a.ADC.reason).toBe('Minimal roles come later (BL-024)');
    expect(a.MID.reason).toBe('Minimal roles come later (BL-024)');
    expect(a.SUPPORT.reason).toBeUndefined();
  });

  it('enabling TOP through the argument works', () => {
    const a = roleAvailability(['SUPPORT', 'TOP']);
    expect(a.TOP).toEqual({ enabled: true });
    expect(a.JUNGLE.enabled).toBe(false);
  });
});
