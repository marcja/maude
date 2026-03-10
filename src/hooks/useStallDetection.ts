/**
 * src/hooks/useStallDetection.ts
 *
 * Detects when a streaming response has stalled — no new token has arrived
 * for STALL_TIMEOUT_MS (8 seconds). Returns `isStalled` state directly so
 * consumers don't need to manage derived state externally via useEffect.
 *
 * Design decisions:
 *
 * Prop-driven rather than imperative: the hook observes `lastTokenAt` (a
 * timestamp set by the parent on each delta) and `isStreaming` rather than
 * exposing a `tick()` method. This keeps the hook declarative — parents don't
 * need to call anything on each token; they just keep lastTokenAt current.
 *
 * Internal state instead of callback: the hook owns `isStalled` state and
 * resets it when `lastTokenAt` or `isStreaming` changes. This eliminates the
 * effect-for-derived-state anti-pattern where consumers would useState +
 * useEffect to mirror hook output — the hook just returns the value directly.
 *
 * useEffect for the timer: the effect re-runs whenever `isStreaming` or
 * `lastTokenAt` changes, which is exactly when the timer needs to be reset.
 * The cleanup function cancels the pending timeout, preventing stale closures
 * from firing after the stream ends or a new token arrives.
 */

import { useEffect, useState } from 'react';

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
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStallDetection({ isStreaming, lastTokenAt }: UseStallDetectionProps) {
  const [isStalled, setIsStalled] = useState(false);

  // lastTokenAt is intentionally a dep to reset the stall timer whenever a new token
  // arrives — this is the mechanism by which the hook detects silence between tokens.
  // Biome's rule doesn't understand time-based resets driven by prop changes that are
  // not read inside the effect body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    // Reset stalled state on any change — new token arrived or stream state changed.
    setIsStalled(false);

    // Only arm the timer when a stream is active.
    if (!isStreaming) return;

    const id = setTimeout(() => {
      setIsStalled(true);
    }, STALL_TIMEOUT_MS);

    // Cleanup: cancel the timer if isStreaming becomes false (stream ended)
    // or lastTokenAt changes (a new token arrived, resetting the window).
    return () => clearTimeout(id);
  }, [isStreaming, lastTokenAt]);

  return { isStalled };
}
