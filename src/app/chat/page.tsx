'use client';

/**
 * src/app/chat/page.tsx
 *
 * Single-column chat page. Wires useStream, MessageList, MessageItem, and
 * InputArea together. Auto-scroll delegated to useAutoScroll hook (T16).
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
 * Auto-scroll (useAutoScroll hook, extracted in T16):
 *   Scrolls to bottom on each token while streaming and not suspended.
 *   resetSuspension() called in handleSubmit to resume auto-scroll for
 *   new turns. Suspension threshold: >50px above bottom (SPEC §4.2).
 */

import { useRef, useState } from 'react';
import { InputArea } from '../../components/chat/InputArea';
import { MessageItem } from '../../components/chat/MessageItem';
import { MessageList } from '../../components/chat/MessageList';
import { useAutoScroll } from '../../hooks/useAutoScroll';
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

  const { tokens, isStreaming, ttft, error, failedMessages, send, stop } = useStream();

  // -------------------------------------------------------------------------
  // Auto-scroll (extracted to useAutoScroll in T16)
  // -------------------------------------------------------------------------

  const listRef = useRef<HTMLDivElement | null>(null);
  const { scrollSuspended, handleScroll, scrollToBottom, resetSuspension } = useAutoScroll({
    listRef,
    isStreaming,
    tokens,
  });

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  const handleSubmit = (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    // Derive BFF context from current history + new user message. No separate
    // apiContext state needed — history already holds all role/content pairs.
    const nextContext = [...history, userMsg].map(({ role, content }) => ({ role, content }));

    // Resume auto-scroll for the new turn before the first token arrives.
    resetSuspension();
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

  const handleRetry = () => {
    if (!failedMessages) return;
    // Re-send the same context that failed. The user message is already in
    // history from the original attempt, so onComplete only needs to append
    // the assistant reply — identical to a normal handleSubmit flow.
    send(failedMessages, undefined, ({ tokens: t, ttft: f }) => {
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
          onClick={scrollToBottom}
        >
          ↓ New content
        </button>
      )}

      {error && (
        <div
          className="chat__error p-2 text-sm text-red-600 bg-red-50 border-t border-red-200 flex items-center gap-2"
          role="alert"
        >
          <span className="flex-1">{error}</span>
          {failedMessages && (
            <button
              type="button"
              className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
              onClick={handleRetry}
            >
              Retry
            </button>
          )}
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
