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
 * - Fetches from /api/conversations on mount (when expanded). The API routes
 *   are created in T26; tests use MSW handlers to mock them.
 *
 * - Client-side types mirror the server's ConversationRow and MessageRow
 *   shapes. Cannot import from src/lib/server/db.ts (server-only boundary).
 *
 * - Delete uses window.confirm() for simplicity — no custom modal needed
 *   for a pedagogical app.
 *
 * - Conversation selection fetches messages via GET /api/conversations/:id
 *   and passes them to the parent via onSelectConversation callback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Client-side types (mirror server shapes from db.ts)
// ---------------------------------------------------------------------------

interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface HistoryMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking: string | null;
  created_at: number;
}

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
}: HistoryPaneProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch conversations list from the API.
  // Accepts an optional AbortSignal so the useEffect cleanup can cancel
  // in-flight requests when the pane collapses or the component unmounts.
  const fetchConversations = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/conversations', { signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: Conversation[] = await res.json();
      setConversations(data);
    } catch (err) {
      // Abort is not an error — the component is unmounting or collapsing.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount when expanded; abort on collapse or unmount.
  useEffect(() => {
    if (collapsed) return;
    const controller = new AbortController();
    fetchConversations(controller.signal);
    return () => controller.abort();
  }, [collapsed, fetchConversations]);

  // Stable ref for onSelectConversation so useCallback doesn't churn.
  const onSelectRef = useRef(onSelectConversation);
  onSelectRef.current = onSelectConversation;

  // Handle selecting a conversation — fetch its messages
  const handleSelect = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { messages: HistoryMessage[] } = await res.json();
      onSelectRef.current(id, data.messages);
    } catch {
      setError('Failed to load conversation');
    }
  }, []);

  // Handle deleting a conversation with confirmation
  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this conversation?')) return;

      try {
        const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Refetch list after successful delete
        await fetchConversations();
      } catch {
        setError('Failed to delete conversation');
      }
    },
    [fetchConversations]
  );

  // -- Collapsed strip: 32px wide with vertical "History" label ---------------
  if (collapsed) {
    return (
      <button
        type="button"
        className="flex h-full w-8 cursor-pointer flex-col items-center border-r border-gray-200 bg-gray-50"
        onClick={onToggle}
        aria-label="Expand history pane"
      >
        <span className="mt-4 text-xs text-gray-500" style={{ writingMode: 'vertical-rl' }}>
          History
        </span>
      </button>
    );
  }

  // -- Expanded pane: 280px fixed width ---------------------------------------
  return (
    <div className="flex h-full w-[280px] flex-col border-r border-gray-200 bg-white">
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

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="py-4 text-center text-xs text-gray-400">Loading…</p>}

        {error && <p className="py-4 text-center text-xs text-red-500">{error}</p>}

        {!loading && !error && conversations.length === 0 && (
          <p className="py-4 text-center text-xs text-gray-400">No conversations yet</p>
        )}

        {!loading && !error && conversations.length > 0 && (
          <div className="flex flex-col">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
  conversation: Conversation;
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
