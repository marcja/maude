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

import { Fragment, useEffect, useRef, useState } from 'react';
import { InputArea } from '../../components/chat/InputArea';
import { MessageItem } from '../../components/chat/MessageItem';
import { MessageList } from '../../components/chat/MessageList';
import { ThinkingBlock } from '../../components/chat/ThinkingBlock';
import { HistoryPane } from '../../components/layout/HistoryPane';
import type { HistoryMessage } from '../../components/layout/HistoryPane';
import { ObservabilityPane } from '../../components/layout/ObservabilityPane';
import { useObservability } from '../../context/ObservabilityContext';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useObservabilityEvents } from '../../hooks/useObservabilityEvents';
import { useStallDetection } from '../../hooks/useStallDetection';
import type { OnStreamComplete } from '../../hooks/useStream';
import type { ConversationSummary, Message as SharedMessage } from '../../lib/shared/types';

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
// Helpers
// ---------------------------------------------------------------------------

const TITLE_MAX_LENGTH = 50;

/** Truncate content to a short title for the chat header. */
function truncateTitle(content: string): string {
  return content.length > TITLE_MAX_LENGTH ? `${content.slice(0, TITLE_MAX_LENGTH)}…` : content;
}

/** Convert server/history messages to the internal Message shape. */
function toLocalMessages(
  messages: ReadonlyArray<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinking?: string | null;
  }>
): Message[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    thinkingText: m.thinking ?? undefined,
  }));
}

export interface ChatShellProps {
  initialConversations: ConversationSummary[];
  /** Pre-fetched conversation ID from /chat/[id] server component. */
  initialConversationId?: string;
  /** Pre-fetched conversation title from /chat/[id] server component. */
  initialConversationTitle?: string;
  /** Pre-fetched messages from /chat/[id] server component. */
  initialMessages?: SharedMessage[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatShell({
  initialConversations,
  initialConversationId,
  initialConversationTitle,
  initialMessages,
}: ChatShellProps) {
  // Map server-fetched messages to the internal Message shape used for rendering.
  // This runs once on mount (via useState initializer) so the conversion cost
  // is only paid when the page first loads with pre-fetched data.
  const [history, setHistory] = useState<Message[]>(() =>
    initialMessages ? toLocalMessages(initialMessages) : []
  );

  // History pane: collapsed by default; expands to show conversation list.
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Active conversation ID — highlighted in the history pane list.
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialConversationId ?? null
  );

  // Conversation title shown centered in the chat header.
  const [activeConversationTitle, setActiveConversationTitle] = useState<string | null>(
    initialConversationTitle ?? null
  );

  // Sync state when the server component re-renders with different props
  // (e.g., browser back/forward triggers router.refresh()). Same prevInitial
  // pattern as HistoryPane — useState only reads the initial value on first
  // mount, so subsequent prop changes need explicit synchronization.
  const [prevInitialId, setPrevInitialId] = useState(initialConversationId);
  if (prevInitialId !== initialConversationId) {
    setPrevInitialId(initialConversationId);
    setActiveConversationId(initialConversationId ?? null);
    setActiveConversationTitle(initialConversationTitle ?? null);
    setHistory(initialMessages ? toLocalMessages(initialMessages) : []);
  }

  // Incremented after each completed stream so HistoryPane re-fetches and
  // shows newly persisted conversations without a full page refresh (B2).
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  // Debug pane toggle — expanded (300px) or collapsed (icon strip).
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
  // Popstate — sync client state when the user navigates with back/forward.
  // Rather than duplicating the server-side fetch logic, we re-fetch the
  // conversation data from the API, matching what HistoryPane already does.
  // -------------------------------------------------------------------------

  useEffect(() => {
    // AbortController cancels any in-flight fetch when a new popstate fires
    // before the previous one settles — prevents stale responses from
    // overwriting the state for the current URL.
    let controller: AbortController | null = null;

    const handlePopState = () => {
      controller?.abort();
      const match = window.location.pathname.match(/^\/chat\/(.+)$/);
      if (match) {
        const id = match[1];
        controller = new AbortController();
        fetch(`/api/conversations/${id}`, { signal: controller.signal })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((data: { messages: HistoryMessage[] }) => {
            setActiveConversationId(id);
            setHistory(toLocalMessages(data.messages));
            const firstUser = data.messages.find((m) => m.role === 'user');
            if (firstUser) {
              setActiveConversationTitle(truncateTitle(firstUser.content));
            }
          })
          .catch((err: unknown) => {
            // Aborted fetches are expected — don't reset state for them.
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setHistory([]);
            setActiveConversationId(null);
            setActiveConversationTitle(null);
          });
      } else {
        // URL is /chat — reset to new chat state.
        setHistory([]);
        setActiveConversationId(null);
        setActiveConversationTitle(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      controller?.abort();
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

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
      // Derive title from first user message for newly created conversations.
      if (!activeConversationId) {
        const firstUserMsg = history.find((m) => m.role === 'user');
        if (firstUserMsg) {
          setActiveConversationTitle(truncateTitle(firstUserMsg.content));
        }
        // Replace (not push) — the transient /chat state shouldn't be in
        // browser back history since it was just a blank starting point.
        window.history.replaceState(null, '', `/chat/${cid}`);
      }
    }
    // Signal HistoryPane to re-fetch when a conversation was persisted.
    // Skip if no conversation ID — means the stream was cancelled before
    // the server created a conversation record.
    if (cid || activeConversationId) {
      setHistoryRefreshToken((prev) => prev + 1);
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
  const handleSelectConversation = (id: string, messages: HistoryMessage[], title: string) => {
    stop();
    setActiveConversationId(id);
    setActiveConversationTitle(title);
    setHistory(toLocalMessages(messages));
    // Push — this is a deliberate navigation the user should be able to
    // go back from.
    window.history.pushState(null, '', `/chat/${id}`);
  };

  const handleNewChat = () => {
    stop();
    setHistory([]);
    setActiveConversationId(null);
    setActiveConversationTitle(null);
    // Push — navigating away from a conversation back to the blank chat.
    window.history.pushState(null, '', '/chat');
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    // Outer flex-row: HistoryPane on the left, center fills remaining width,
    // ObservabilityPane on the right. Both side panes independently collapsible.
    <div className="flex h-screen w-full overflow-hidden">
      {/* Left pane — always mounted; icon strip when collapsed, 280px expanded */}
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
      <div className="chat-page flex flex-1 min-w-0 min-h-0 flex-col">
        {/* Header — conversation title, vertically aligned with sidebar icons.
             pt-5 positions the text midline to match the ~32px icon centers
             in both sidebars (pt-3 + half of h-10). */}
        <div className="flex items-center px-4 pt-5 pb-2">
          <button
            type="button"
            aria-label="Open history"
            className="sm:hidden p-1 text-content-faint hover:text-content-muted"
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
          {activeConversationTitle && (
            <h1 className="flex-1 truncate text-sm text-content-muted">
              {activeConversationTitle}
            </h1>
          )}
        </div>

        {/* Chat content area — max-w-3xl keeps readable line lengths centered */}
        <div className="flex flex-1 min-w-0 min-h-0 flex-col max-w-3xl mx-auto w-full">
          {/* Wrapper gives the FAB a positioning context scoped to the
              message list area — so bottom-3 lands just above the list's
              lower edge, not inside the InputArea below. */}
          <div className="relative flex-1 min-h-0 flex flex-col">
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
                    isStalled={isStalled}
                    ttft={ttft}
                    onCopy={handleCopy}
                    onCancel={stop}
                  />
                </>
              )}
            </MessageList>

            {/* Scroll-to-bottom FAB — visible whenever the user has scrolled
                 away from the bottom, not only during streaming. Matches the
                 Claude.ai pattern: a round button with a down-arrow chevron.
                 Positioned relative to the message list wrapper so it floats
                 just above the list's bottom edge. */}
            {scrollSuspended && (
              <button
                type="button"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-edge bg-surface-raised text-content-muted shadow-lg transition-all hover:bg-surface-overlay hover:text-content"
                onClick={scrollToBottom}
                aria-label="Scroll to bottom"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <title>Scroll to bottom</title>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3"
                  />
                </svg>
              </button>
            )}
          </div>

          {error && (
            <div
              className="chat__error p-2 text-sm text-red-400 bg-red-500/10 border-t border-red-500/20 flex items-center gap-2"
              role="alert"
            >
              <span className="flex-1">{error}</span>
              {failedMessages && (
                <button
                  type="button"
                  className="px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
                  onClick={handleRetry}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <InputArea isStreaming={isStreaming} onSubmit={handleSubmit} onStop={stop} />
        </div>
      </div>

      {/* Right pane — always mounted; icon strip when collapsed, 300px expanded */}
      <ObservabilityPane
        collapsed={!paneExpanded}
        onToggle={() => setPaneExpanded((prev) => !prev)}
      />
    </div>
  );
}
