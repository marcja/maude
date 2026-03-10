/**
 * src/hooks/__tests__/useStallDetection.test.ts
 *
 * Tests for the useStallDetection hook.
 *
 * useStallDetection returns `isStalled` — true when no new token arrives
 * within 8 seconds of the previous one (or stream start). It resets on each
 * token change and clears when the stream ends.
 *
 * Why jest fake timers: the hook uses setTimeout internally. Fake timers let us
 * advance time without real delays, making the tests instant and deterministic.
 *
 * Why renderHook + act: state transitions from timers require act() so React
 * flushes effects synchronously in the test environment.
 */

import { act, renderHook } from '@testing-library/react';
import { useStallDetection } from '../useStallDetection';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Suite 1: stall detection fires after timeout
// ---------------------------------------------------------------------------

describe('useStallDetection — stall detection', () => {
  it('returns isStalled=true after 8 seconds with no new token while streaming', () => {
    const { result } = renderHook(() =>
      useStallDetection({ isStreaming: true, lastTokenAt: null })
    );

    expect(result.current.isStalled).toBe(false);

    // Less than 8s: not stalled yet
    act(() => {
      jest.advanceTimersByTime(7999);
    });
    expect(result.current.isStalled).toBe(false);

    // Exactly 8s: stalled
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.isStalled).toBe(true);
  });

  it('returns isStalled=false when isStreaming is false', () => {
    const { result } = renderHook(() =>
      useStallDetection({ isStreaming: false, lastTokenAt: null })
    );

    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(result.current.isStalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: timer resets when lastTokenAt changes
// ---------------------------------------------------------------------------

describe('useStallDetection — timer reset on token', () => {
  it('resets the 8s timer when lastTokenAt changes', () => {
    const { result, rerender } = renderHook(
      ({ lastTokenAt }: { lastTokenAt: number | null }) =>
        useStallDetection({ isStreaming: true, lastTokenAt }),
      { initialProps: { lastTokenAt: null as number | null } }
    );

    // Advance 7s — not stalled yet
    act(() => {
      jest.advanceTimersByTime(7000);
    });
    expect(result.current.isStalled).toBe(false);

    // Token arrives at 7s — timer should reset to 8s from now
    act(() => {
      rerender({ lastTokenAt: 7000 });
    });

    // Advance another 7s (14s total) — timer was reset so not stalled yet
    act(() => {
      jest.advanceTimersByTime(7000);
    });
    expect(result.current.isStalled).toBe(false);

    // Advance 1 more second — 8s have now passed since last token
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.isStalled).toBe(true);
  });

  it('resets isStalled to false when a new token arrives', () => {
    const { result, rerender } = renderHook(
      ({ lastTokenAt }: { lastTokenAt: number | null }) =>
        useStallDetection({ isStreaming: true, lastTokenAt }),
      { initialProps: { lastTokenAt: null as number | null } }
    );

    // Become stalled
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.isStalled).toBe(true);

    // Token arrives — should reset to not stalled
    act(() => {
      rerender({ lastTokenAt: 8000 });
    });
    expect(result.current.isStalled).toBe(false);
  });

  it('does not stall if a token arrives just before the deadline', () => {
    const { result, rerender } = renderHook(
      ({ lastTokenAt }: { lastTokenAt: number | null }) =>
        useStallDetection({ isStreaming: true, lastTokenAt }),
      { initialProps: { lastTokenAt: null as number | null } }
    );

    // Advance to 7.9s, then emit a token
    act(() => {
      jest.advanceTimersByTime(7900);
    });
    act(() => {
      rerender({ lastTokenAt: 7900 });
    });

    // Advance to just under 16s (7.9 + 7.9)
    act(() => {
      jest.advanceTimersByTime(7900);
    });
    expect(result.current.isStalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: timer clears when stream ends
// ---------------------------------------------------------------------------

describe('useStallDetection — clears on stream end', () => {
  it('cancels the stall timer when isStreaming becomes false', () => {
    const { result, rerender } = renderHook(
      ({ isStreaming }: { isStreaming: boolean }) =>
        useStallDetection({ isStreaming, lastTokenAt: null }),
      { initialProps: { isStreaming: true } }
    );

    // Advance 5s into the stall window
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Stream ends — timer should be cancelled
    act(() => {
      rerender({ isStreaming: false });
    });

    // Advance past the 8s mark — must NOT become stalled
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.isStalled).toBe(false);
  });

  it('resets isStalled to false when isStreaming becomes false', () => {
    const { result, rerender } = renderHook(
      ({ isStreaming }: { isStreaming: boolean }) =>
        useStallDetection({ isStreaming, lastTokenAt: null }),
      { initialProps: { isStreaming: true } }
    );

    // Become stalled
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.isStalled).toBe(true);

    // Stream ends — should reset
    act(() => {
      rerender({ isStreaming: false });
    });
    expect(result.current.isStalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: stall fires only once per stall period
// ---------------------------------------------------------------------------

describe('useStallDetection — stays stalled', () => {
  it('stays stalled (does not toggle) after the initial 8s timeout', () => {
    const { result } = renderHook(() =>
      useStallDetection({ isStreaming: true, lastTokenAt: null })
    );

    // Fire the 8s stall
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.isStalled).toBe(true);

    // Advance another 8s — should still be stalled (no extra timer set)
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.isStalled).toBe(true);
  });

  it('re-arms the timer if a new token arrives after a stall', () => {
    const { result, rerender } = renderHook(
      ({ lastTokenAt }: { lastTokenAt: number | null }) =>
        useStallDetection({ isStreaming: true, lastTokenAt }),
      { initialProps: { lastTokenAt: null as number | null } }
    );

    // Fire the initial stall
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.isStalled).toBe(true);

    // A token arrives after the stall — should reset and re-arm
    act(() => {
      rerender({ lastTokenAt: 8000 });
    });
    expect(result.current.isStalled).toBe(false);

    // Another 8s with no token — should stall again
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.isStalled).toBe(true);
  });
});
