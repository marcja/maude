'use client';

/**
 * src/components/chat/StallIndicator.tsx
 *
 * "Still working…" banner shown when the token stream stalls for 8+ seconds.
 * Gives the user immediate feedback that the model is unresponsive and offers
 * a Cancel button to abort the request.
 *
 * Pure presentational — the parent manages `isStalled` state via
 * useStallDetection's onStall callback and clears it on token arrival
 * or stream end.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StallIndicatorProps {
  /** True when no token has arrived for STALL_TIMEOUT_MS (8 s). */
  isStalled: boolean;
  /** Called when the user clicks Cancel to abort the stalled stream. */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StallIndicator({ isStalled, onCancel }: StallIndicatorProps) {
  if (!isStalled) return null;

  return (
    <output className="stall-indicator mb-2 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
      Still working…
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-0.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
      >
        Cancel
      </button>
    </output>
  );
}
