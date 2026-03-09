/**
 * src/hooks/__tests__/useStallDetection.test.ts
 *
 * Tests for the useStallDetection hook.
 *
 * useStallDetection fires a callback when no new token arrives within 8 seconds
 * of the previous one (or stream start). It resets on each token and clears
 * when the stream ends.
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
// Suite 1: stall callback fires after timeout
// ---------------------------------------------------------------------------

describe('useStallDetection — stall detection', () => {
  it('calls onStall after 8 seconds with no new token while streaming', () => {
    const onStall = jest.fn();
    renderHook(() => useStallDetection({ isStreaming: true, lastTokenAt: null, onStall }));

    // Less than 8s: no stall yet
    act(() => {
      jest.advanceTimersByTime(7999);
    });
    expect(onStall).not.toHaveBeenCalled();

    // Exactly 8s: stall fires
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('does not call onStall when isStreaming is false', () => {
    const onStall = jest.fn();
    renderHook(() => useStallDetection({ isStreaming: false, lastTokenAt: null, onStall }));

    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(onStall).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: timer resets when lastTokenAt changes
// ---------------------------------------------------------------------------

describe('useStallDetection — timer reset on token', () => {
  it('resets the 8s timer when lastTokenAt changes', () => {
    const onStall = jest.fn();
    const { rerender } = renderHook(
      ({ lastTokenAt }: { lastTokenAt: number | null }) =>
        useStallDetection({ isStreaming: true, lastTokenAt, onStall }),
      { initialProps: { lastTokenAt: null as number | null } }
    );

    // Advance 7s — no stall yet
    act(() => {
      jest.advanceTimersByTime(7000);
    });
    expect(onStall).not.toHaveBeenCalled();

    // Token arrives at 7s — timer should reset to 8s from now
    act(() => {
      rerender({ lastTokenAt: 7000 });
    });

    // Advance another 7s (14s total) — timer was reset so no stall yet
    act(() => {
      jest.advanceTimersByTime(7000);
    });
    expect(onStall).not.toHaveBeenCalled();

    // Advance 1 more second — 8s have now passed since last token
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('does not fire stall if a token arrives just before the deadline', () => {
    const onStall = jest.fn();
    const { rerender } = renderHook(
      ({ lastTokenAt }: { lastTokenAt: number | null }) =>
        useStallDetection({ isStreaming: true, lastTokenAt, onStall }),
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
    expect(onStall).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: timer clears when stream ends
// ---------------------------------------------------------------------------

describe('useStallDetection — clears on stream end', () => {
  it('cancels the stall timer when isStreaming becomes false', () => {
    const onStall = jest.fn();
    const { rerender } = renderHook(
      ({ isStreaming }: { isStreaming: boolean }) =>
        useStallDetection({ isStreaming, lastTokenAt: null, onStall }),
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

    // Advance past the 8s mark — onStall must NOT fire
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onStall).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: stall fires only once per stall period
// ---------------------------------------------------------------------------

describe('useStallDetection — fires once', () => {
  it('calls onStall exactly once per stall, not repeatedly', () => {
    const onStall = jest.fn();
    renderHook(() => useStallDetection({ isStreaming: true, lastTokenAt: null, onStall }));

    // Fire the 8s stall
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(onStall).toHaveBeenCalledTimes(1);

    // Advance another 8s — should NOT fire again (no new timer set)
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('re-arms the timer if a new token arrives after a stall', () => {
    const onStall = jest.fn();
    const { rerender } = renderHook(
      ({ lastTokenAt }: { lastTokenAt: number | null }) =>
        useStallDetection({ isStreaming: true, lastTokenAt, onStall }),
      { initialProps: { lastTokenAt: null as number | null } }
    );

    // Fire the initial stall
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(onStall).toHaveBeenCalledTimes(1);

    // A token arrives after the stall — should re-arm the 8s timer
    act(() => {
      rerender({ lastTokenAt: 8000 });
    });

    // Another 8s with no token — should fire stall again
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(onStall).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: callback identity — ref indirection protects against stale closures
// ---------------------------------------------------------------------------

describe('useStallDetection — callback identity', () => {
  it('uses the latest onStall callback without resetting the timer', () => {
    // The hook stores onStall in a ref so that swapping the callback mid-stream
    // does not restart the setTimeout. This test guards that ref indirection.
    const onStall1 = jest.fn();
    const onStall2 = jest.fn();

    const { rerender } = renderHook(
      ({ onStall }: { onStall: () => void }) =>
        useStallDetection({ isStreaming: true, lastTokenAt: null, onStall }),
      { initialProps: { onStall: onStall1 } }
    );

    // Advance 5s into the stall window
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Swap the callback mid-stream (simulates parent re-render with new closure)
    act(() => {
      rerender({ onStall: onStall2 });
    });

    // Advance the remaining 3s — should fire onStall2, NOT onStall1
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(onStall1).not.toHaveBeenCalled();
    expect(onStall2).toHaveBeenCalledTimes(1);
  });
});
