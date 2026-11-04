import { describe, expect, it } from 'vitest';

import { backtestPassedValidation } from './backtest-validation.js';

describe('backtestPassedValidation', () => {
  it('rejects missing and malformed reports', () => {
    expect(backtestPassedValidation(null)).toBe(false);
    expect(backtestPassedValidation({ validationStatus: 'validated' })).toBe(false);
  });

  it('does not treat a lower raw log loss as passing the D-023 gate', () => {
    expect(
      backtestPassedValidation({
        validationStatus: 'unvalidated',
        logLoss: 0.4,
        baselineLogLoss: 0.7,
      }),
    ).toBe(false);
  });

  it('accepts a validated report only when its log loss beats the baseline', () => {
    expect(
      backtestPassedValidation({
        validationStatus: 'validated',
        logLoss: 0.4,
        baselineLogLoss: 0.7,
      }),
    ).toBe(true);
    expect(
      backtestPassedValidation({
        validationStatus: 'validated',
        logLoss: 0.7,
        baselineLogLoss: 0.7,
      }),
    ).toBe(false);
  });
});
