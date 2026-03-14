'use client';

/**
 * src/components/chat/ChatShell.tsx
 *
 * Client component extracted from chat/page.tsx so the page can become a
 * server component that pre-fetches data. All interactive chat logic lives
 * here; the parent server component passes initialConversations so the
 * HistoryPane renders without a loading flash.
 *
 * See chat/page.tsx header comment (kept for git history) for full design
 * rationale on layout, streaming, auto-scroll, and stall detection.
 */

import Link from 'next/link';
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
import type { ConversationSummary } from '../../lib/shared/types';

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

export interface ChatShellProps {
  initialConversations: ConversationSummary[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatShell({ initialConversations }: ChatShellProps) {
  // Finalized conversation messages (user turns + completed assistant turns).
  const [history, setHistory] = useState<Message[]>([]);

  // History pane: collapsed by default; expands to show conversation list.
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Active conversation ID — highlighted in the history pane list.
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Incremented after each completed stream so HistoryPane re-fetches and
  // shows newly persisted conversations without a full page refresh (B2).
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

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
    // Signal HistoryPane to re-fetch regardless of whether the assistant
    // produced tokens — the conversation was still persisted server-side.
    setHistoryRefreshToken((prev) => prev + 1);
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
        refreshToken={historyRefreshToken}
        initialConversations={initialConversations}
      />

      {/* Center column — chat UI */}
      <div className="chat-page flex flex-1 min-w-0 flex-col">
        {/* Header bar with navigation, new chat, and gear toggle for debug pane */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-1">
          <div className="flex items-center gap-3">
            {/* Mobile-only hamburger to open history pane */}
            <button
              type="button"
              aria-label="Open history"
              className="sm:hidden p-1 text-gray-400 hover:text-gray-600"
              onClick={() => setHistoryExpanded(true)}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <title>Menu</title>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link href="/" className="text-sm font-semibold text-gray-900 hover:text-gray-600">
              Maude
            </Link>
            <Link href="/settings" className="text-sm text-gray-400 hover:text-gray-600">
              Settings
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
            >
              + New chat
            </button>
            <button
              type="button"
              aria-label="Toggle debug pane"
              className={`p-1 text-lg transition-colors ${paneExpanded ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
              onClick={() => setPaneExpanded((prev) => !prev)}
            >
              ⚙
            </button>
          </div>
        </div>

        {/* Chat content area — max-w-3xl keeps readable line lengths centered */}
        <div className="relative flex flex-1 min-w-0 flex-col max-w-3xl mx-auto w-full">
          <MessageList
            listRef={listRef}
            onScroll={handleScroll}
            messageCount={history.length}
            isStreaming={isStreaming}
            onSuggestionClick={handleSubmit}
          >
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
