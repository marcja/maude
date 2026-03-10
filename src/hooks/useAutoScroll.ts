/**
 * src/hooks/useAutoScroll.ts
 *
 * Manages scroll-to-bottom behavior during streaming: scrolls on each new
 * token, suspends when the user scrolls up, and resumes when the user
 * returns near the bottom.
 *
 * Design decisions:
 *
 * listRef as prop, not created internally: MessageList already needs the ref
 * for rendering. The hook reads scroll measurements and writes scrollTop but
 * does not own the DOM element.
 *
 * scrollSuspended owned internally: keeps scroll logic self-contained. The
 * parent gets resetSuspension() for the one external trigger (new message
 * submit should resume auto-scroll for the new turn).
 *
 * tokens as trigger dependency: the hook does not read the string value —
 * only the fact that it changed drives a scroll. This matches the SSE model
 * where each token appends to the accumulated string.
 *
 * requestAnimationFrame coalescing: multiple tokens arriving within a single
 * display frame (~16ms at 60Hz) would each trigger a synchronous layout
 * reflow via scrollTop assignment. rAF batches them into one scroll per frame.
 */

import { type RefObject, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Distance from bottom (px) above which auto-scroll suspends (SPEC §4.2). */
const SCROLL_THRESHOLD_PX = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAutoScrollProps {
  /** Ref to the scrollable container element (owned by parent/MessageList). */
  listRef: RefObject<HTMLDivElement | null>;
  /** True while a stream is active — drives auto-scroll on content changes. */
  isStreaming: boolean;
  /**
   * Accumulated token string. The hook does not read its value — only reacts
   * to changes as a trigger to scroll.
   */
  tokens: string;
}

export interface UseAutoScrollResult {
  /** True when the user has scrolled >50px above the bottom during streaming. */
  scrollSuspended: boolean;
  /** Scroll event handler — attach to the scrollable container's onScroll. */
  handleScroll: () => void;
  /**
   * Imperatively scroll to bottom and resume auto-scroll. Used by the
   * "↓ New content" button.
   */
  scrollToBottom: () => void;
  /**
   * Reset suspension state without scrolling. Called by the parent when a new
   * message is submitted so auto-scroll resumes for the new turn.
   */
  resetSuspension: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAutoScroll({
  listRef,
  isStreaming,
  tokens,
}: UseAutoScrollProps): UseAutoScrollResult {
  const [scrollSuspended, setScrollSuspended] = useState(false);

  // Scroll to bottom on each token during active streaming (unless suspended).
  // `tokens` drives re-execution on each new token; its value is not needed in
  // the body — only the fact that it changed matters.
  //
  // requestAnimationFrame coalesces multiple scroll updates within a single
  // display frame, preventing redundant synchronous reflows when tokens arrive
  // faster than the display refresh rate (60Hz = ~16ms). Without rAF, 30-50
  // tokens/sec would each trigger a layout reflow via scrollTop assignment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tokens is an intentional trigger dep — its value is not read, only its change matters
  useEffect(() => {
    if (!isStreaming || scrollSuspended) return;
    const id = requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [tokens, isStreaming, scrollSuspended, listRef]);

  // Suspend auto-scroll if user has scrolled more than 50px above bottom
  // (SPEC §4.2: "more than 50px above the bottom").
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setScrollSuspended(el.scrollHeight - el.scrollTop - el.clientHeight > SCROLL_THRESHOLD_PX);
  };

  // Imperatively scroll to bottom and clear suspension. Used by the
  // "↓ New content" button — needs both the scroll and the state reset.
  // Synchronous (no rAF) because this is a discrete user action, not a
  // high-frequency streaming update — immediate visual feedback matters more
  // than coalescing.
  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setScrollSuspended(false);
  };

  // Reset suspension without scrolling. Called on new message submit so
  // auto-scroll resumes when the next token arrives (the useEffect above
  // handles the actual scroll).
  const resetSuspension = () => {
    setScrollSuspended(false);
  };

  return { scrollSuspended, handleScroll, scrollToBottom, resetSuspension };
}
