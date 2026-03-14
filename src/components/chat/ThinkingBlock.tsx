'use client';

/**
 * src/components/chat/ThinkingBlock.tsx
 *
 * Collapsible "Thought for Xs" disclosure that sits above the assistant's
 * visible response whenever the model emits a <think>...</think> reasoning trace.
 *
 * Design decisions:
 *
 * Three display states driven by props:
 *   isThinking=true  → "Thinking…" header + content visible (stream is open)
 *   isThinking=false + text  → "Thought for Xs" header + collapsed by default
 *   isThinking=false + text="" → renders nothing (no thinking in this message)
 *
 * Collapsed-by-default after completion: reasoning traces are rarely needed
 * for day-to-day use but are valuable for debugging. Hiding them by default
 * keeps the chat clean while making the trace discoverable via click.
 *
 * Content visible during streaming: as tokens arrive the user can watch the
 * model think — collapsing mid-stream would hide live updates. The component
 * auto-collapses only after the stream completes (isThinking → false).
 *
 * durationMs is computed externally (in the parent that receives thinking_block_start
 * and thinking_block_stop events) so this component stays purely presentational.
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ThinkingBlockProps {
  /** Accumulated reasoning text from thinking_delta events. */
  text: string;
  /** True while thinking_block_start has fired but thinking_block_stop has not. */
  isThinking: boolean;
  /** Wall-clock duration in ms from thinking_block_start to thinking_block_stop.
   *  Null while still streaming or when no timing data is available. */
  durationMs: number | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThinkingBlock({ text, isThinking, durationMs }: ThinkingBlockProps) {
  // Collapsed by default so the chat stays clean after the trace completes.
  // No need to initialize open=true for streaming: we render content
  // unconditionally while isThinking is true (see render logic below).
  const [open, setOpen] = useState(false);

  // Render nothing if there is no thinking content and streaming hasn't started.
  // This avoids an empty disclosure element appearing on non-thinking messages.
  if (!isThinking && !text) return null;

  // History-restored messages lack timing data (durationMs is null),
  // so show bare "Thought" instead of the misleading "Thought for 0s".
  const label = isThinking
    ? 'Thinking…'
    : durationMs !== null
      ? `Thought for ${Math.floor(durationMs / 1000)}s`
      : 'Thought';

  // Content is visible while streaming (so the user watches live) or when
  // the user has clicked to expand after completion.
  const contentVisible = isThinking || open;

  return (
    <div className="thinking-block mb-2 rounded border border-gray-200 bg-gray-50 text-sm">
      <button
        type="button"
        className="thinking-block__header flex w-full items-center gap-1 px-3 py-1.5 text-left text-gray-500 hover:bg-gray-100"
        onClick={() => setOpen((o) => !o)}
        // Disable toggle while streaming — clicking during stream would collapse
        // live content. The button remains in the DOM for layout consistency.
        disabled={isThinking}
        aria-expanded={contentVisible}
      >
        {/* Chevron indicator: rotates 90° when expanded */}
        <span
          className={`inline-block transition-transform ${contentVisible ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          ›
        </span>
        <span>{label}</span>
      </button>

      {contentVisible && (
        <div className="thinking-block__content max-h-[200px] overflow-y-auto px-3 py-2 font-mono text-xs text-gray-600 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
