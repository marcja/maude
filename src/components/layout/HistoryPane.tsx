'use client';

/**
 * src/components/layout/HistoryPane.tsx
 *
 * Left sidebar that lists past conversations. Follows the same collapsible
 * pane pattern as ObservabilityPane: 280px expanded, 32px collapsed strip
 * with a vertical "History" label.
 *
 * Design decisions:
 *
 * - Server component parent passes initialConversations so the pane renders
 *   with data immediately (no loading flash). The useEffect re-fetch on
 *   expand/refreshToken keeps data fresh after mutations.
 *
 * - Types are imported from src/lib/shared/types.ts — the single source of
 *   truth for domain types shared across the server-only and client boundaries.
 *
 * - Delete uses window.confirm() for simplicity — no custom modal needed
 *   for a pedagogical app.
 *
 * - Conversation selection and deletion use useTransition with async callbacks
 *   (React 19) rather than manual loading/error state management.
 */

import { useEffect, useState, useTransition } from 'react';

import type { ConversationSummary, Message } from '../../lib/shared/types';

// Re-export Message under the name consumers already depend on.
// chat/page.tsx imports HistoryMessage from this module.
export type HistoryMessage = Message;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HistoryPaneProps {
  /** Whether the pane is collapsed to a 32px strip. */
  collapsed: boolean;
  /** Toggle between collapsed and expanded states. */
  onToggle: () => void;
  /** Called when user clicks a conversation — receives the ID and its messages. */
  onSelectConversation: (id: string, messages: HistoryMessage[]) => void;
  /** Called when user clicks "New Chat". */
  onNewChat: () => void;
  /** ID of the currently active conversation (highlighted in the list). */
  activeConversationId: string | null;
  /** Incremented by the parent after each completed stream to trigger a
   *  re-fetch of the conversation list (B2: history pane refresh). */
  refreshToken?: number;
  /** Server-fetched conversations passed from the server component parent.
   *  Eliminates the loading flash on initial render — the useEffect fetch
   *  still runs on expand/refresh to keep data fresh. */
  initialConversations?: ConversationSummary[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a timestamp as a short relative or absolute date string. */
function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HistoryPane({
  collapsed,
  onToggle,
  onSelectConversation,
  onNewChat,
  activeConversationId,
  refreshToken,
  initialConversations,
}: HistoryPaneProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    initialConversations ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync conversations state when the server-provided initialConversations
  // prop changes (e.g., after a client-side navigation triggers a new server
  // render). useState only reads the initial value on first mount, so
  // subsequent prop changes need explicit state synchronization.
  const [prevInitial, setPrevInitial] = useState(initialConversations);
  if (prevInitial !== initialConversations) {
    setPrevInitial(initialConversations);
    setConversations(initialConversations ?? []);
  }

  // useTransition wraps select and delete actions so React can track their
  // pending state automatically. Both are user-initiated async mutations
  // that should not block the UI — useTransition marks their state updates
  // as non-urgent so the pane stays interactive during the fetch.
  const [, startTransition] = useTransition();

  // Fetch conversations when expanded, and re-fetch when refreshToken changes
  // (e.g., after a stream completes and a new conversation is persisted).
  // Merged into a single effect to prevent double-fetching when collapsed
  // transitions to false while refreshToken is already non-zero.
  // Fetch logic is inlined so no function reference needs tracking.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is an intentional trigger — its value change signals "re-fetch now", not a stale closure risk
  useEffect(() => {
    if (collapsed) return;
    const controller = new AbortController();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/conversations', { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ConversationSummary[] = await res.json();
        setConversations(data);
      } catch (err) {
        // Abort is not an error — the component is unmounting or collapsing.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError('Failed to load conversations');
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [collapsed, refreshToken]);

  // Handle selecting a conversation — fetch its messages.
  // Wrapped in startTransition so React tracks the async operation as
  // non-urgent, keeping the pane interactive while messages load.
  function handleSelect(id: string) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/conversations/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { messages: HistoryMessage[] } = await res.json();
        onSelectConversation(id, data.messages);
      } catch {
        setError('Failed to load conversation');
      }
    });
  }

  // Handle deleting a conversation with confirmation.
  // window.confirm() runs synchronously before the transition; the async
  // delete + re-fetch runs inside startTransition so the pane stays
  // interactive and React batches the resulting state updates.
  function handleDelete(id: string) {
    if (!window.confirm('Delete this conversation?')) return;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Re-fetch list after successful delete
        const listRes = await fetch('/api/conversations');
        if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
        const data: ConversationSummary[] = await listRes.json();
        setConversations(data);
      } catch {
        setError('Failed to delete conversation');
      }
    });
  }

  // -- Collapsed strip: 32px wide with vertical "History" label ---------------
  if (collapsed) {
    return (
      <button
        type="button"
        className="hidden sm:flex h-full w-8 cursor-pointer flex-col items-center border-r border-gray-200 bg-gray-50"
        onClick={onToggle}
        aria-label="Expand history pane"
      >
        <span className="mt-4 text-xs text-gray-500" style={{ writingMode: 'vertical-rl' }}>
          History
        </span>
      </button>
    );
  }

  // -- Expanded pane: overlay on mobile, side-by-side at sm: and above --------
  return (
    <>
      {/* Backdrop — mobile only. Tap to dismiss the overlay. */}
      <div
        className="fixed inset-0 z-40 bg-black/30 sm:hidden"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onToggle();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close history pane"
      />
      <div className="fixed inset-y-0 left-0 z-50 sm:relative sm:z-auto flex h-full w-[280px] flex-col border-r border-gray-200 bg-white transition-transform duration-200 sm:transition-all sm:duration-200 sm:ease-out">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5">
          <button
            type="button"
            aria-label="Collapse history pane"
            className="text-xs font-semibold text-gray-700 hover:text-gray-500"
            onClick={onToggle}
          >
            History
          </button>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
            onClick={onNewChat}
          >
            New Chat
          </button>
        </div>

        {/* Content area — show existing conversations even during a background
             refresh so server-provided initialConversations remain visible while
             the useEffect re-fetch is in flight. */}
        <div className="flex-1 overflow-y-auto">
          {loading && conversations.length === 0 && (
            <p className="py-4 text-center text-xs text-gray-400">Loading…</p>
          )}

          {error && <p className="py-4 text-center text-xs text-red-500">{error}</p>}

          {!loading && !error && conversations.length === 0 && (
            <p className="py-4 text-center text-xs text-gray-400">No conversations yet</p>
          )}

          {conversations.length > 0 && (
            <div className="flex flex-col">
              {groupByDate(conversations).map(({ group, items }) => (
                <div key={group}>
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    {group}
                  </div>
                  {items.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isActive={conv.id === activeConversationId}
                      onSelect={handleSelect}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Date grouping helpers
// ---------------------------------------------------------------------------

type DateGroup = 'Today' | 'Yesterday' | 'Last week' | 'Older';

/** Assign a conversation to a date group based on its updated_at timestamp. */
function getDateGroup(ts: number): DateGroup {
  const now = new Date();
  const date = new Date(ts);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Last week';
  return 'Older';
}

/** Group conversations by date bucket, preserving order within each group. */
function groupByDate(
  conversations: ConversationSummary[]
): { group: DateGroup; items: ConversationSummary[] }[] {
  const order: DateGroup[] = ['Today', 'Yesterday', 'Last week', 'Older'];
  const buckets: Record<DateGroup, ConversationSummary[]> = {
    Today: [],
    Yesterday: [],
    'Last week': [],
    Older: [],
  };
  for (const conv of conversations) {
    const group = getDateGroup(conv.updated_at);
    buckets[group].push(conv);
  }
  return order.filter((g) => buckets[g].length > 0).map((g) => ({ group: g, items: buckets[g] }));
}

// ---------------------------------------------------------------------------
// Sub-component: single conversation item
// ---------------------------------------------------------------------------

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      data-testid="conversation-item"
      data-active={isActive ? 'true' : 'false'}
      className={`group flex items-center justify-between px-3 py-2 text-sm ${
        isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onSelect(conversation.id)}
      >
        <div className="truncate text-sm text-gray-800">{conversation.title}</div>
        <div className="text-xs text-gray-400">{formatDate(conversation.updated_at)}</div>
      </button>
      <button
        type="button"
        aria-label="Delete conversation"
        className="ml-2 shrink-0 rounded p-1 text-xs text-gray-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(conversation.id);
        }}
      >
        ✕
      </button>
    </div>
  );
}
