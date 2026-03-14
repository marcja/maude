'use client';

/**
 * src/components/chat/MessageList.tsx
 *
 * Scroll container for the chat message list. Intentionally thin — all scroll
 * logic (auto-scroll, suspension, "↓ New content" button) lives in the parent
 * (chat/page.tsx) so T16 can extract it into useAutoScroll without touching
 * this component.
 *
 * Design decision: `listRef` is passed in rather than created here because the
 * parent needs imperative access to scrollTop/scrollHeight. React 19 supports
 * `ref` as a regular prop (no forwardRef needed), but `listRef` as a named prop
 * is preferred for semantic clarity — it communicates that the parent owns scroll
 * control, not that this component exposes its root element.
 */

import type { RefObject } from 'react';

// ---------------------------------------------------------------------------
// Suggestion chips for the empty state
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Explain how streaming works',
  'Write a haiku about coding',
  'What can you help me with?',
];

interface MessageListProps {
  /** Ref owned by the parent for imperative scroll control. */
  listRef: RefObject<HTMLDivElement | null>;
  /** Called on every native scroll event; parent updates suspension state. */
  onScroll: () => void;
  children: React.ReactNode;
  /** Number of finalized messages — controls empty state visibility. */
  messageCount: number;
  /** True while the assistant stream is in progress. */
  isStreaming: boolean;
  /** Called when user clicks a suggestion chip to send a pre-filled message. */
  onSuggestionClick?: (text: string) => void;
}

export function MessageList({
  listRef,
  onScroll,
  children,
  messageCount,
  isStreaming,
  onSuggestionClick,
}: MessageListProps) {
  const showEmptyState = messageCount === 0 && !isStreaming;

  return (
    // flex-1 fills available height; overflow-y-auto scrolls when content overflows.
    // Without a bounded height the div expands to fit content and never scrolls,
    // breaking auto-scroll and the "↓ New content" button.
    <div
      ref={listRef}
      data-testid="message-list"
      className="message-list flex-1 overflow-y-auto p-4"
      onScroll={onScroll}
    >
      {showEmptyState ? (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <h2 className="text-2xl font-light text-content-muted">How can I help?</h2>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-full border border-edge px-4 py-2 text-sm text-content-muted transition-all hover:border-edge-hover hover:bg-surface-raised hover:text-content"
                onClick={() => onSuggestionClick?.(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
