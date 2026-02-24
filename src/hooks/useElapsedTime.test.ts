import { renderHook, act } from '@testing-library/react';

import { useElapsedTime } from './useElapsedTime';

describe('useElapsedTime', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('returns null when startedAt is undefined', () => {
    const { result } = renderHook(() => useElapsedTime(undefined));
    expect(result.current).toBeNull();
  });

  it('returns a formatted string when startedAt is provided (seconds only)', () => {
    const startedAt = new Date('2025-12-31T23:59:30.000Z').toISOString();
    const { result } = renderHook(() => useElapsedTime(startedAt));
    // 30 seconds elapsed
    expect(result.current).toBe('30s');
  });

  it('returns a formatted string with minutes when elapsed >= 60s', () => {
    const startedAt = new Date('2025-12-31T23:57:22.000Z').toISOString();
    const { result } = renderHook(() => useElapsedTime(startedAt));
    // 2m 38s elapsed
    expect(result.current).toBe('2m 38s');
  });

  it('updates after 10 seconds via setInterval', () => {
    // Start: T=0 relative to a startedAt 5 seconds before system time
    const startedAt = new Date('2025-12-31T23:59:55.000Z').toISOString();
    const { result } = renderHook(() => useElapsedTime(startedAt));
    // Initially 5s elapsed
    expect(result.current).toBe('5s');

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    // Now 15s elapsed
    expect(result.current).toBe('15s');
  });

  it('returns null when startedAt transitions from defined to undefined', () => {
    let startedAt: string | undefined = new Date('2025-12-31T23:59:30.000Z').toISOString();
    const { result, rerender } = renderHook(() => useElapsedTime(startedAt));
    expect(result.current).not.toBeNull();

    startedAt = undefined;
    rerender();
    expect(result.current).toBeNull();
  });
});
