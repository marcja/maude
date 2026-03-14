'use client';

/**
 * src/app/chat/page.tsx
 *
 * Three-column chat page — M4 milestone. Left column: collapsible HistoryPane;
 * center: chat UI; right: collapsible ObservabilityPane (toggled via ⚙ button).
 *
 * Design decisions:
 *
 * Three-column flex layout:
 *   Outer div is flex-row h-screen. HistoryPane sits on the left (280px
 *   expanded, 32px collapsed). Center column is flex-1 min-w-0 so it fills
 *   remaining width. ObservabilityPane sits on the right (300px / 32px).
 *   Both side panes are independently collapsible; center always fills
 *   remaining width.
 *
 * History pane integration (T23):
 *   HistoryPane fetches from /api/conversations on mount. Clicking a
 *   conversation loads its messages into the chat via onSelectConversation.
 *   Loaded messages become the conversation context — subsequent sends
 *   include all prior messages so the model has full context.
 *
 * Single-level toggle:
 *   The ⚙ button toggles between expanded (300px) and collapsed (32px strip).
 *   No separate "hidden" state — the pane is always mounted so context state
 *   is preserved. Clicking the collapsed strip also expands (for discoverability).
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
 *
 * Stall detection (useStallDetection, T14):
 *   useStallDetection returns isStalled directly — no external state or
 *   effect needed. Resets internally on token arrival or stream end.
 *
 * Thinking blocks (ThinkingBlock, T12):
 *   Live thinking state from useStream renders above the assistant message.
 *   Finalized thinking data stored in history for re-display on scroll-back.
 */

import { Fragment, useRef, useState } from 'react';
import { InputArea } from '../../components/chat/InputArea';
import { MessageItem } from '../../components/chat/MessageItem';
import { MessageList } from '../../components/chat/MessageList';
import { StallIndicator } from '../../components/chat/StallIndicator';
import { ThinkingBlock } from '../../components/chat/ThinkingBlock';
import { HistoryPane } from '../../components/layout/HistoryPane';
import type { HistoryMessage } from '../../components/layout/HistoryPane';
import { ObservabilityPane } from '../../components/layout/ObservabilityPane';
import { useObservability } from '../../context/ObservabilityContext';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useObservabilityEvents } from '../../hooks/useObservabilityEvents';
import { useStallDetection } from '../../hooks/useStallDetection';
import type { OnStreamComplete } from '../../hooks/useStream';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ttft?: number | null;
  thinkingText?: string;
  thinkingDurationMs?: number | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  // Finalized conversation messages (user turns + completed assistant turns).
  const [history, setHistory] = useState<Message[]>([]);

  // History pane: collapsed by default; expands to show conversation list.
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Active conversation ID — highlighted in the history pane list.
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Debug pane: ⚙ button toggles between expanded (300px) and collapsed (32px strip).
  // Single toggle level — no separate "hidden" vs "collapsed" states.
  const [paneExpanded, setPaneExpanded] = useState(false);

  const { addEvent } = useObservability();

  const {
    tokens,
    isStreaming,
    ttft,
    error,
    failedMessages,
    thinkingText,
    isThinking,
    thinkingDurationMs,
    lastTokenAt,
    send,
    stop,
  } = useObservabilityEvents();

  // Callback for MessageItem copy button — emits response_copied to the
  // observability event bus so the Events tab shows copy actions.
  const handleCopy = () => {
    addEvent({
      type: 'response_copied',
      payload: '',
      timestamp: Date.now(),
      requestId: null,
    });
  };

  // -------------------------------------------------------------------------
  // Stall detection (T14/T15)
  // -------------------------------------------------------------------------

  const { isStalled } = useStallDetection({ isStreaming, lastTokenAt });

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

  // Shared onComplete callback for send() — appends the finalized assistant
  // message to history. Used by both handleSubmit and handleRetry so the
  // finalization logic lives in one place.
  const appendAssistant = ({
    tokens: t,
    ttft: f,
    thinkingText: tt,
    thinkingDurationMs: td,
    conversationId: cid,
  }: Parameters<OnStreamComplete>[0]) => {
    if (t) {
      setHistory((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: t,
          ttft: f,
          thinkingText: tt ?? undefined,
          thinkingDurationMs: td,
        },
      ]);
    }
    // Persist the server-assigned conversation ID so subsequent turns are
    // appended to the same conversation rather than creating a new one.
    if (cid) {
      setActiveConversationId(cid);
    }
  };

  const handleSubmit = (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    // Derive BFF context from current history + new user message. No separate
    // apiContext state needed — history already holds all role/content pairs.
    const nextContext = [...history, userMsg].map(({ role, content }) => ({ role, content }));

    // Resume auto-scroll for the new turn before the first token arrives.
    resetSuspension();
    setHistory((prev) => [...prev, userMsg]);

    send(nextContext, activeConversationId, appendAssistant);
  };

  const handleRetry = () => {
    if (!failedMessages) return;
    // Re-send the same context that failed. The user message is already in
    // history from the original attempt, so onComplete only needs to append
    // the assistant reply — identical to a normal handleSubmit flow.
    send(failedMessages, activeConversationId, appendAssistant);
  };

  // Handle selecting a conversation from the history pane — loads its
  // messages into the chat as if they were locally produced turns.
  const handleSelectConversation = (id: string, messages: HistoryMessage[]) => {
    stop();
    setActiveConversationId(id);
    setHistory(
      messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        thinkingText: m.thinking ?? undefined,
      }))
    );
  };

  const handleNewChat = () => {
    stop();
    setHistory([]);
    setActiveConversationId(null);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    // Outer flex-row: HistoryPane on the left, center fills remaining width,
    // ObservabilityPane on the right. Both side panes independently collapsible.
    <div className="flex h-screen w-full">
      {/* Left pane — always mounted; collapsed strip or 280px expanded */}
      <HistoryPane
        collapsed={!historyExpanded}
        onToggle={() => setHistoryExpanded((prev) => !prev)}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        activeConversationId={activeConversationId}
      />

      {/* Center column — chat UI */}
      <div className="chat-page flex flex-1 min-w-0 flex-col">
        {/* Header bar with gear toggle for debug pane */}
        <div className="flex items-center justify-end border-b border-gray-200 px-4 py-1">
          <button
            type="button"
            aria-label="Toggle debug pane"
            className={`p-1 text-lg transition-colors ${paneExpanded ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            onClick={() => setPaneExpanded((prev) => !prev)}
          >
            ⚙
          </button>
        </div>

        {/* Chat content area — max-w-3xl keeps readable line lengths centered */}
        <div className="relative flex flex-1 min-w-0 flex-col max-w-3xl mx-auto w-full">
          <MessageList listRef={listRef} onScroll={handleScroll}>
            {history.map((m) => (
              <Fragment key={m.id}>
                {m.role === 'assistant' && m.thinkingText && (
                  <ThinkingBlock
                    text={m.thinkingText}
                    isThinking={false}
                    durationMs={m.thinkingDurationMs ?? null}
                  />
                )}
                <MessageItem
                  sender={m.role}
                  content={m.content}
                  ttft={m.ttft}
                  onCopy={m.role === 'assistant' ? handleCopy : undefined}
                />
              </Fragment>
            ))}
            {isStreaming && (
              <>
                <ThinkingBlock
                  text={thinkingText}
                  isThinking={isThinking}
                  durationMs={thinkingDurationMs}
                />
                <MessageItem
                  sender="assistant"
                  content={tokens}
                  isStreaming={isStreaming}
                  ttft={ttft}
                  onCopy={handleCopy}
                />
                <StallIndicator isStalled={isStalled} onCancel={stop} />
              </>
            )}
          </MessageList>

          {isStreaming && scrollSuspended && (
            <button
              type="button"
              className="absolute bottom-20 right-4 bg-blue-600 text-white px-3 py-1 rounded"
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
      </div>

      {/* Right pane — always mounted; gear toggles between expanded and collapsed strip */}
      <ObservabilityPane
        collapsed={!paneExpanded}
        onToggle={() => setPaneExpanded((prev) => !prev)}
      />
    </div>
  );
}
