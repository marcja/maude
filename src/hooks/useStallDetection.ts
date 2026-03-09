/**
 * src/hooks/useStallDetection.ts
 *
 * Detects when a streaming response has stalled — no new token has arrived
 * for STALL_TIMEOUT_MS (8 seconds). Fires onStall once per stall period;
 * resets the timer on each new token; cancels when streaming ends.
 *
 * Design decisions:
 *
 * Prop-driven rather than imperative: the hook observes `lastTokenAt` (a
 * timestamp set by the parent on each delta) and `isStreaming` rather than
 * exposing a `tick()` method. This keeps the hook declarative — parents don't
 * need to call anything on each token; they just keep lastTokenAt current.
 *
 * useEffect for the timer: the effect re-runs whenever `isStreaming` or
 * `lastTokenAt` changes, which is exactly when the timer needs to be reset.
 * The cleanup function cancels the pending timeout, preventing stale closures
 * from firing after the stream ends or a new token arrives.
 *
 * onStall in a ref: wrapping the callback in a ref avoids including it in
 * the effect dependency array. If the caller passes an inline function, a
 * new reference on every render would restart the timer unnecessarily.
 */

import { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALL_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseStallDetectionProps {
  /** True while the stream is active. Timer only runs while streaming. */
  isStreaming: boolean;
  /**
   * Timestamp (ms, e.g. Date.now()) of the most recent token arrival.
   * Set to null at stream start (before the first token).
   * Each change resets the stall timer.
   */
  lastTokenAt: number | null;
  /** Called once when no token has arrived for STALL_TIMEOUT_MS. */
  onStall: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStallDetection({ isStreaming, lastTokenAt, onStall }: UseStallDetectionProps) {
  // Stable ref for the callback so timer effects don't re-run on every render
  // when the caller passes a new function reference (e.g., an inline arrow).
  const onStallRef = useRef(onStall);
  useEffect(() => {
    onStallRef.current = onStall;
  }, [onStall]);

  // lastTokenAt is intentionally a dep to reset the stall timer whenever a new token
  // arrives — this is the mechanism by which the hook detects silence between tokens.
  // Biome's rule doesn't understand time-based resets driven by prop changes that are
  // not read inside the effect body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    // Only arm the timer when a stream is active.
    if (!isStreaming) return;

    const id = setTimeout(() => {
      onStallRef.current();
    }, STALL_TIMEOUT_MS);

    // Cleanup: cancel the timer if isStreaming becomes false (stream ended)
    // or lastTokenAt changes (a new token arrived, resetting the window).
    return () => clearTimeout(id);
  }, [isStreaming, lastTokenAt]);
}
