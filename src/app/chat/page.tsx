'use client';

/**
 * src/app/chat/page.tsx
 *
 * M1 milestone: the minimal single-column chat page. Wires useStream,
 * MessageList, MessageItem, and InputArea together with auto-scroll logic.
 *
 * Design decisions:
 *
 * Streaming finalization via onComplete callback:
 *   Rather than a useEffect that watches isStreaming for a true→false
 *   transition, we pass an onComplete callback to send(). useStream calls it
 *   at message_stop and on abort, batching the setHistory call with the
 *   isStreaming: false state update — one render, no flicker.
 *
 * Live assistant message:
 *   {isStreaming && <MessageItem ... />} renders the live assistant turn while
 *   tokens arrive. Because onComplete batches setHistory with isStreaming:false,
 *   the live message and the finalized history entry swap atomically.
 *
 * Auto-scroll (inline for T10; T16 extracts to useAutoScroll):
 *   A single useEffect scrolls to bottom on every `tokens` change while
 *   streaming and not suspended. `scrollSuspended` resets in handleSubmit
 *   (semantically: resume auto-scroll when the user sends a new message).
 *   The scroll handler sets suspension when the user is >50px above the
 *   bottom (SPEC §4.2).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { InputArea } from '../../components/chat/InputArea';
import { MessageItem } from '../../components/chat/MessageItem';
import { MessageList } from '../../components/chat/MessageList';
import { useStream } from '../../hooks/useStream';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ttft?: number | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  // Finalized conversation messages (user turns + completed assistant turns).
  const [history, setHistory] = useState<Message[]>([]);
  // True when the user has scrolled >50px above the bottom during streaming.
  const [scrollSuspended, setScrollSuspended] = useState(false);

  const { tokens, isStreaming, ttft, error, send, stop } = useStream();

  // -------------------------------------------------------------------------
  // Auto-scroll (inline; T16 will extract to useAutoScroll hook)
  // -------------------------------------------------------------------------

  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on each token during active streaming (unless suspended).
  // `tokens` drives re-execution on each new token; its value is not needed in
  // the body — only the fact that it changed matters.
  //
  // requestAnimationFrame coalesces multiple scroll updates within a single
  // display frame, preventing redundant synchronous reflows when tokens arrive
  // faster than the display refresh rate (60Hz = ~16ms). Without rAF, 30-50
  // tokens/sec would each trigger a layout reflow via scrollTop assignment.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger dep
  useEffect(() => {
    if (!isStreaming || scrollSuspended) return;
    const id = requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [tokens, isStreaming, scrollSuspended]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // Suspend auto-scroll if user has scrolled more than 50px above bottom
    // (SPEC §4.2: "more than 50px above the bottom").
    setScrollSuspended(el.scrollHeight - el.scrollTop - el.clientHeight > 50);
  }, []);

  const handleScrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setScrollSuspended(false);
  };

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  const handleSubmit = (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    // Derive BFF context from current history + new user message. No separate
    // apiContext state needed — history already holds all role/content pairs.
    const nextContext = [...history, userMsg].map(({ role, content }) => ({ role, content }));

    // Resume auto-scroll for the new turn before the first token arrives.
    setScrollSuspended(false);
    setHistory((prev) => [...prev, userMsg]);

    send(nextContext, undefined, ({ tokens: t, ttft: f }) => {
      // onComplete is called at message_stop (and on abort) from inside send()'s
      // async loop. React 18 automatic batching merges this setState with the
      // isStreaming: false update into one render — the finalized assistant
      // message and the live-message disappearance happen atomically.
      if (t) {
        setHistory((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: t, ttft: f },
        ]);
      }
    });
  };

  const handleNewChat = () => {
    stop();
    setHistory([]);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    // flex flex-col h-screen: full viewport height column layout so MessageList
    // (flex-1 overflow-y-auto) fills the remaining space and scrolls correctly.
    // max-w-3xl mx-auto: center content with horizontal breathing room.
    <div className="chat-page flex flex-col h-screen max-w-3xl mx-auto w-full">
      <MessageList listRef={listRef} onScroll={handleScroll}>
        {history.map((m) => (
          <MessageItem key={m.id} sender={m.role} content={m.content} ttft={m.ttft} />
        ))}
        {isStreaming && (
          <MessageItem sender="assistant" content={tokens} isStreaming={isStreaming} ttft={ttft} />
        )}
      </MessageList>

      {isStreaming && scrollSuspended && (
        <button
          type="button"
          className="fixed bottom-20 right-4 bg-blue-600 text-white px-3 py-1 rounded"
          onClick={handleScrollToBottom}
        >
          ↓ New content
        </button>
      )}

      {error && (
        <div className="p-2 text-sm text-red-600 bg-red-50 border-t border-red-200" role="alert">
          {error}
        </div>
      )}

      <InputArea
        isStreaming={isStreaming}
        onSubmit={handleSubmit}
        onStop={stop}
        onNewChat={handleNewChat}
      />
    </div>
  );
}
