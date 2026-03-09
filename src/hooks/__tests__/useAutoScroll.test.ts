/**
 * src/hooks/__tests__/useAutoScroll.test.ts
 *
 * Tests for the useAutoScroll hook.
 *
 * useAutoScroll manages scroll-to-bottom behavior during streaming: it scrolls
 * on each token change, suspends when the user scrolls up, and resumes when
 * the user returns near the bottom.
 *
 * Why mock requestAnimationFrame: the hook coalesces scroll updates via rAF.
 * Mocking it to invoke callbacks synchronously makes tests deterministic.
 *
 * Why a mock ref: the hook reads scrollHeight/scrollTop/clientHeight and writes
 * scrollTop. A plain object with these properties suffices — no real DOM needed.
 */

import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { useAutoScroll } from '../useAutoScroll';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Create a mock HTMLDivElement ref with controllable scroll measurements.
 *  Defaults: scrollHeight=1000, scrollTop=950, clientHeight=50 → gap=0 (at bottom). */
function createMockRef(
  scrollHeight = 1000,
  scrollTop = 950,
  clientHeight = 50
): RefObject<HTMLDivElement | null> {
  // Only the scroll-related properties are needed. Cast through unknown
  // because the hook only accesses scrollHeight, scrollTop, clientHeight.
  const el = { scrollHeight, scrollTop, clientHeight } as unknown as HTMLDivElement;
  return { current: el };
}

/** Read scrollTop from a mock ref (centralizes the `as unknown` cast). */
function getScrollTop(ref: RefObject<HTMLDivElement | null>): number {
  return (ref.current as unknown as { scrollTop: number }).scrollTop;
}

/** Write scrollTop on a mock ref (centralizes the `as unknown` cast). */
function setScrollTop(ref: RefObject<HTMLDivElement | null>, value: number): void {
  (ref.current as unknown as { scrollTop: number }).scrollTop = value;
}

// Store original rAF/cAF so we can restore after tests
const originalRAF = globalThis.requestAnimationFrame;
const originalCAF = globalThis.cancelAnimationFrame;

beforeEach(() => {
  // Synchronous rAF: invoke the callback immediately so scroll effects
  // execute within the same act() block.
  let rafId = 0;
  globalThis.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
    cb(0);
    return ++rafId;
  });
  globalThis.cancelAnimationFrame = jest.fn();
});

afterEach(() => {
  globalThis.requestAnimationFrame = originalRAF;
  globalThis.cancelAnimationFrame = originalCAF;
});

// ---------------------------------------------------------------------------
// Suite 1: auto-scroll during streaming
// ---------------------------------------------------------------------------

describe('useAutoScroll — auto-scroll during streaming', () => {
  it('scrolls to bottom on token change while streaming', () => {
    const ref = createMockRef(2000, 0, 500);
    const { rerender } = renderHook(
      ({ tokens }: { tokens: string }) =>
        useAutoScroll({ listRef: ref, isStreaming: true, tokens }),
      { initialProps: { tokens: 'hello' } }
    );

    // Token change triggers scroll
    act(() => {
      rerender({ tokens: 'hello world' });
    });

    // scrollTop should be set to scrollHeight
    expect(getScrollTop(ref)).toBe(2000);
  });

  it('does not scroll when isStreaming is false', () => {
    const ref = createMockRef(2000, 0, 500);
    const { rerender } = renderHook(
      ({ tokens, isStreaming }: { tokens: string; isStreaming: boolean }) =>
        useAutoScroll({ listRef: ref, isStreaming, tokens }),
      { initialProps: { tokens: 'hello', isStreaming: false } }
    );

    act(() => {
      rerender({ tokens: 'hello world', isStreaming: false });
    });

    // scrollTop should remain at initial value
    expect(getScrollTop(ref)).toBe(0);
  });

  it('does not throw when ref is null during streaming', () => {
    const ref: RefObject<HTMLDivElement | null> = { current: null };

    // Should not throw — the rAF callback's null guard skips the scroll
    expect(() => {
      renderHook(
        ({ tokens }: { tokens: string }) =>
          useAutoScroll({ listRef: ref, isStreaming: true, tokens }),
        { initialProps: { tokens: 'a' } }
      );
    }).not.toThrow();
  });

  it('does not scroll when scroll is suspended', () => {
    const ref = createMockRef(2000, 0, 500);
    const { result, rerender } = renderHook(
      ({ tokens }: { tokens: string }) =>
        useAutoScroll({ listRef: ref, isStreaming: true, tokens }),
      { initialProps: { tokens: 'a' } }
    );

    // Simulate user scrolling up (gap = 2000 - 1400 - 500 = 100 > 50)
    setScrollTop(ref, 1400);
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.scrollSuspended).toBe(true);

    // Reset scrollTop to track whether scroll effect fires
    setScrollTop(ref, 0);

    act(() => {
      rerender({ tokens: 'ab' });
    });

    // scrollTop should remain 0 — auto-scroll is suspended
    expect(getScrollTop(ref)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: scroll suspension
// ---------------------------------------------------------------------------

describe('useAutoScroll — scroll suspension', () => {
  it('starts with scrollSuspended false', () => {
    const ref = createMockRef();
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: false, tokens: '' })
    );
    expect(result.current.scrollSuspended).toBe(false);
  });

  it('sets scrollSuspended true when user scrolls >50px above bottom', () => {
    const ref = createMockRef(2000, 0, 500);
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: true, tokens: '' })
    );

    // Simulate user scrolling up: gap = 2000 - 1400 - 500 = 100 > 50
    setScrollTop(ref, 1400);
    act(() => {
      result.current.handleScroll();
    });

    expect(result.current.scrollSuspended).toBe(true);
  });

  it('sets scrollSuspended false when user returns within 50px of bottom', () => {
    const ref = createMockRef(2000, 0, 500);
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: true, tokens: '' })
    );

    // First: suspend (gap = 2000 - 1400 - 500 = 100 > 50)
    setScrollTop(ref, 1400);
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.scrollSuspended).toBe(true);

    // Then: scroll back near bottom (gap = 2000 - 1470 - 500 = 30 ≤ 50)
    setScrollTop(ref, 1470);
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.scrollSuspended).toBe(false);
  });

  it('handles null ref gracefully', () => {
    const ref: RefObject<HTMLDivElement | null> = { current: null };
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: true, tokens: '' })
    );

    // Should not throw
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.scrollSuspended).toBe(false);
  });

  it('does not suspend at exactly 50px (boundary: > not >=)', () => {
    // gap = scrollHeight - scrollTop - clientHeight = 2000 - 1450 - 500 = 50
    // SPEC §4.2: "more than 50px" => strict >, so exactly 50 should NOT suspend
    const ref = createMockRef(2000, 0, 500);
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: true, tokens: '' })
    );

    setScrollTop(ref, 1450);
    act(() => {
      result.current.handleScroll();
    });

    expect(result.current.scrollSuspended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: scrollToBottom
// ---------------------------------------------------------------------------

describe('useAutoScroll — scrollToBottom', () => {
  it('scrolls to bottom and resets suspension', () => {
    const ref = createMockRef(2000, 0, 500);
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: true, tokens: '' })
    );

    // Suspend: simulate user scrolling up (gap = 100 > 50)
    setScrollTop(ref, 1400);
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.scrollSuspended).toBe(true);

    act(() => {
      result.current.scrollToBottom();
    });

    expect(result.current.scrollSuspended).toBe(false);
    expect(getScrollTop(ref)).toBe(2000);
  });

  it('handles null ref gracefully', () => {
    const ref: RefObject<HTMLDivElement | null> = { current: null };
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: true, tokens: '' })
    );

    // Should not throw — null guard in scrollToBottom skips the scroll
    act(() => {
      result.current.scrollToBottom();
    });
    expect(result.current.scrollSuspended).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: resetSuspension
// ---------------------------------------------------------------------------

describe('useAutoScroll — resetSuspension', () => {
  it('resets scrollSuspended without scrolling', () => {
    // Use isStreaming=false so the auto-scroll effect does not fire after
    // resetSuspension clears scrollSuspended — isolating the function's own
    // behavior (state reset only, no scroll).
    const ref = createMockRef(2000, 0, 500);
    const { result } = renderHook(() =>
      useAutoScroll({ listRef: ref, isStreaming: false, tokens: '' })
    );

    // Suspend: simulate user scrolling up (gap = 100 > 50)
    setScrollTop(ref, 1400);
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.scrollSuspended).toBe(true);

    act(() => {
      result.current.resetSuspension();
    });

    expect(result.current.scrollSuspended).toBe(false);
    // scrollTop unchanged — resetSuspension does not scroll
    expect(getScrollTop(ref)).toBe(1400);
  });

  it('allows auto-scroll to resume on next token when streaming', () => {
    // Production scenario: user submits a new message while suspended —
    // resetSuspension clears the flag so the next token triggers auto-scroll.
    const ref = createMockRef(2000, 0, 500);
    const { result, rerender } = renderHook(
      ({ tokens }: { tokens: string }) =>
        useAutoScroll({ listRef: ref, isStreaming: true, tokens }),
      { initialProps: { tokens: 'a' } }
    );

    // Suspend
    setScrollTop(ref, 1400);
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.scrollSuspended).toBe(true);

    // Reset (simulates new message submit)
    act(() => {
      result.current.resetSuspension();
    });

    // Reset scrollTop to track whether auto-scroll fires
    setScrollTop(ref, 0);
    act(() => {
      rerender({ tokens: 'ab' });
    });

    // Auto-scroll should have fired since suspension was cleared
    expect(getScrollTop(ref)).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: requestAnimationFrame coalescing
// ---------------------------------------------------------------------------

describe('useAutoScroll — rAF coalescing', () => {
  it('uses requestAnimationFrame for scroll updates', () => {
    const ref = createMockRef(2000, 0, 500);
    renderHook(
      ({ tokens }: { tokens: string }) =>
        useAutoScroll({ listRef: ref, isStreaming: true, tokens }),
      { initialProps: { tokens: 'a' } }
    );

    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
  });

  it('cancels pending rAF on cleanup when effect re-runs', () => {
    // Use a deferred rAF (callback stored, not invoked immediately) so
    // cancelAnimationFrame is meaningfully exercised on the next effect run.
    let storedId = 100;
    globalThis.requestAnimationFrame = jest.fn(() => ++storedId);

    const ref = createMockRef(2000, 0, 500);
    const { rerender } = renderHook(
      ({ tokens }: { tokens: string }) =>
        useAutoScroll({ listRef: ref, isStreaming: true, tokens }),
      { initialProps: { tokens: 'a' } }
    );

    const firstId = storedId;

    act(() => {
      rerender({ tokens: 'ab' });
    });

    // The cleanup from the first effect should have cancelled the first rAF id.
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(firstId);
  });

  it('does not call requestAnimationFrame when not streaming', () => {
    const ref = createMockRef(2000, 0, 500);
    (globalThis.requestAnimationFrame as jest.Mock).mockClear();

    renderHook(() => useAutoScroll({ listRef: ref, isStreaming: false, tokens: 'a' }));

    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });
});
