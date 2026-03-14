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

interface MessageListProps {
  /** Ref owned by the parent for imperative scroll control. */
  listRef: RefObject<HTMLDivElement | null>;
  /** Called on every native scroll event; parent updates suspension state. */
  onScroll: () => void;
  children: React.ReactNode;
}

export function MessageList({ listRef, onScroll, children }: MessageListProps) {
  return (
    // flex-1 fills available height; overflow-y-auto scrolls when content overflows.
    // Without a bounded height the div expands to fit content and never scrolls,
    // breaking auto-scroll and the "↓ New content" button.
    <div
      ref={listRef}
      className="message-list flex-1 overflow-y-auto bg-gray-50 p-4"
      onScroll={onScroll}
    >
      {children}
    </div>
  );
}
