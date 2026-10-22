import { describe, it, expect } from 'vitest';
import { add } from './hello.js';

describe('add', () => {
  it('adds two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('handles zero', () => {
    expect(add(0, 0)).toBe(0);
  });

  it('handles negative numbers', () => {
    expect(add(-1, 1)).toBe(0);
  });
});
