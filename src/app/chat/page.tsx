'use client';

/**
 * src/app/chat/page.tsx
 *
 * Two-column chat page — M3 milestone. Center column holds the chat UI;
 * right column holds the collapsible ObservabilityPane (toggled via ⚙ button).
 *
 * Design decisions:
 *
 * Two-column flex layout:
 *   Outer div is flex-row h-screen. Center column is flex-1 min-w-0 so it
 *   fills remaining width when the pane is open, collapsed, or hidden.
 *   Inner content div retains max-w-3xl mx-auto for readable line lengths.
 *
 * Gear toggle vs pane collapse:
 *   The ⚙ button controls whether the ObservabilityPane is mounted at all.
 *   Once visible, the pane's own ◂/▸ buttons handle collapse to 32px strip.
 *   This two-level visibility keeps the chat page clean when debugging isn't
 *   needed while preserving the pane's internal state when toggling collapse.
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
 *   Watches lastTokenAt from useStream; fires onStall after 8s silence.
 *   isStalled state resets on token arrival or stream end via useEffect.
 *
 * Thinking blocks (ThinkingBlock, T12):
 *   Live thinking state from useStream renders above the assistant message.
 *   Finalized thinking data stored in history for re-display on scroll-back.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { InputArea } from '../../components/chat/InputArea';
import { MessageItem } from '../../components/chat/MessageItem';
import { MessageList } from '../../components/chat/MessageList';
import { StallIndicator } from '../../components/chat/StallIndicator';
import { ThinkingBlock } from '../../components/chat/ThinkingBlock';
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

  // Debug pane visibility — starts hidden; ⚙ button toggles it on/off.
  // Once visible, the pane's own collapse/expand handles 300px↔32px sizing.
  const [showPane, setShowPane] = useState(false);

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
  const handleCopy = useCallback(() => {
    addEvent({
      type: 'response_copied',
      payload: '',
      timestamp: Date.now(),
      requestId: null,
    });
  }, [addEvent]);

  // -------------------------------------------------------------------------
  // Stall detection (T14/T15)
  // -------------------------------------------------------------------------

  const [isStalled, setIsStalled] = useState(false);
  useStallDetection({ isStreaming, lastTokenAt, onStall: () => setIsStalled(true) });

  // Reset isStalled when a new token arrives or streaming ends. useStallDetection
  // only fires onStall once per stall period — the reset must happen externally
  // so the indicator disappears on token arrival.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastTokenAt is an intentional trigger dep — its change (not value) signals token arrival
  useEffect(() => {
    setIsStalled(false);
  }, [lastTokenAt, isStreaming]);

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
  }: Parameters<OnStreamComplete>[0]) => {
    if (t) {
      setHistory((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: t,
          ttft: f,
          thinkingText: tt || undefined,
          thinkingDurationMs: td,
        },
      ]);
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

    send(nextContext, undefined, appendAssistant);
  };

  const handleRetry = () => {
    if (!failedMessages) return;
    // Re-send the same context that failed. The user message is already in
    // history from the original attempt, so onComplete only needs to append
    // the assistant reply — identical to a normal handleSubmit flow.
    send(failedMessages, undefined, appendAssistant);
  };

  const handleNewChat = () => {
    stop();
    setHistory([]);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    // Outer flex-row: center column fills remaining width; ObservabilityPane
    // sits on the right at 300px (expanded) or 32px (collapsed).
    <div className="flex h-screen w-full">
      {/* Center column — chat UI */}
      <div className="chat-page flex flex-1 min-w-0 flex-col">
        {/* Header bar with gear toggle for debug pane */}
        <div className="flex items-center justify-end border-b border-gray-200 px-4 py-1">
          <button
            type="button"
            aria-label="Toggle debug pane"
            className={`p-1 text-lg transition-colors ${showPane ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            onClick={() => setShowPane((prev) => !prev)}
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

      {/* Right pane — ObservabilityPane (mounted only when gear is toggled on) */}
      {showPane && <ObservabilityPane />}
    </div>
  );
}
