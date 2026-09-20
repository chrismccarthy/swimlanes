import { describe, it, expect, afterEach, vi } from 'vitest';
import { backoffDelay, BACKOFF_MAX_MS } from './backoff';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Pin the jitter to the middle of its range so the nominal delay shows through. */
function noJitter() {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
}

describe('backoffDelay', () => {
  it('doubles from one second', () => {
    noJitter();
    expect([0, 1, 2, 3].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000]);
  });

  it('caps at 30 seconds however long the outage lasts', () => {
    noJitter();
    expect(backoffDelay(5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(50)).toBe(BACKOFF_MAX_MS);
  });

  it('spreads retries either side of the nominal delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(backoffDelay(1)).toBe(1500);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(backoffDelay(1)).toBeGreaterThan(2400);
    expect(backoffDelay(1)).toBeLessThanOrEqual(2500);
  });

  it('never exceeds the cap once jitter is applied', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(backoffDelay(10)).toBe(BACKOFF_MAX_MS);
  });
});
