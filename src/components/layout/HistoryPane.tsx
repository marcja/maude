'use client';

/**
 * src/components/layout/HistoryPane.tsx
 *
 * Left sidebar that lists past conversations. Claude.ai-style layout:
 * collapsed = icon-only strip (~56px), expanded = icons + text labels
 * with conversation list below.
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

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import type { ConversationSummary, Message } from '../../lib/shared/types';

// Re-export Message under the name consumers already depend on.
// chat/page.tsx imports HistoryMessage from this module.
export type HistoryMessage = Message;

// ---------------------------------------------------------------------------
// Icons — inline SVGs matching Claude.ai's sidebar icon style
// ---------------------------------------------------------------------------

function SidebarIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <title>Toggle sidebar</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"
      />
    </svg>
  );
}

function PlusIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <title>New chat</title>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ChatIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <title>Chats</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
      />
    </svg>
  );
}

function SettingsIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <title>Settings</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HistoryPaneProps {
  /** Whether the pane is collapsed to an icon strip. */
  collapsed: boolean;
  /** Toggle between collapsed and expanded states. */
  onToggle: () => void;
  /** Called when user clicks a conversation — receives the ID and its messages. */
  onSelectConversation: (id: string, messages: HistoryMessage[], title: string) => void;
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
  function handleSelect(id: string, title: string) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/conversations/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { messages: HistoryMessage[] } = await res.json();
        onSelectConversation(id, data.messages, title);
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

  // -- Collapsed strip: icon-only, same layout as expanded nav ----------------
  // Uses identical px-2 + inner w-10 icon containers so icons don't shift
  // when toggling between collapsed and expanded states.
  if (collapsed) {
    return (
      <nav
        className="hidden sm:flex h-full w-14 flex-col border-r border-edge-hover bg-surface-dim pt-3 gap-1 px-2"
        aria-label="Sidebar"
      >
        <button
          type="button"
          className="flex h-10 items-center justify-center rounded-lg text-content-faint transition-colors hover:bg-surface-raised hover:text-content-muted"
          onClick={onToggle}
          aria-label="Expand sidebar"
        >
          <SidebarIcon />
        </button>

        <button
          type="button"
          className="flex h-10 items-center justify-center rounded-lg text-content-faint transition-colors hover:bg-surface-raised hover:text-content-muted"
          onClick={onNewChat}
          aria-label="New chat"
        >
          <PlusIcon />
        </button>

        <button
          type="button"
          className="flex h-10 items-center justify-center rounded-lg text-content-faint transition-colors hover:bg-surface-raised hover:text-content-muted"
          onClick={onToggle}
          aria-label="View history"
        >
          <ChatIcon />
        </button>

        <Link
          href="/settings"
          className="flex h-10 items-center justify-center rounded-lg text-content-faint transition-colors hover:bg-surface-raised hover:text-content-muted"
          aria-label="Settings"
        >
          <SettingsIcon />
        </Link>
      </nav>
    );
  }

  // -- Expanded pane: overlay on mobile, side-by-side at sm: and above --------
  return (
    <>
      {/* Backdrop — mobile only. Tap to dismiss the overlay. */}
      <div
        className="fixed inset-0 z-40 bg-black/50 sm:hidden"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onToggle();
        }}
        role="button"
        tabIndex={-1}
        aria-label="Close history pane"
      />
      <div className="fixed inset-y-0 left-0 z-50 sm:relative sm:z-auto flex h-full w-[280px] flex-col border-r border-edge bg-surface-dim transition-transform duration-200 sm:transition-all sm:duration-200 sm:ease-out">
        {/* Navigation — same vertical rhythm as collapsed icon strip so icons
            stay at the same y-position when toggling between states. Each row
            is h-10 with gap-1, matching the collapsed nav exactly. */}
        {/* Navigation uses identical px-2 pt-3 gap-1 as collapsed strip.
             Each button has the icon in a w-10 centered container matching
             the collapsed w-14 - px-2*2 = w-10 available space exactly. */}
        <div className="flex flex-col gap-1 px-2 pt-3 pb-2 border-b border-edge">
          <button
            type="button"
            aria-label="Collapse sidebar"
            className="flex h-10 items-center rounded-lg text-content-faint transition-colors hover:bg-surface-raised hover:text-content-muted"
            onClick={onToggle}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center">
              <SidebarIcon />
            </span>
          </button>

          <button
            type="button"
            className="flex h-10 items-center rounded-lg text-content-muted transition-colors hover:bg-surface-raised hover:text-content"
            onClick={onNewChat}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center">
              <PlusIcon />
            </span>
            <span className="text-sm">New chat</span>
          </button>

          <button
            type="button"
            className="flex h-10 items-center rounded-lg text-content-muted transition-colors hover:bg-surface-raised hover:text-content"
            onClick={onToggle}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center">
              <ChatIcon />
            </span>
            <span className="text-sm">Chats</span>
          </button>

          <Link
            href="/settings"
            className="flex h-10 items-center rounded-lg text-content-muted transition-colors hover:bg-surface-raised hover:text-content"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center">
              <SettingsIcon />
            </span>
            <span className="text-sm">Settings</span>
          </Link>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {loading && conversations.length === 0 && (
            <p className="py-4 text-center text-xs text-content-faint">Loading…</p>
          )}

          {error && <p className="py-4 text-center text-xs text-red-400">{error}</p>}

          {!loading && !error && conversations.length === 0 && (
            <p className="py-4 text-center text-xs text-content-faint">No conversations yet</p>
          )}

          {conversations.length > 0 && (
            <div className="flex flex-col">
              {groupByDate(conversations).map(({ group, items }) => (
                <div key={group}>
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-content-faint">
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
  onSelect: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      data-testid="conversation-item"
      data-active={isActive ? 'true' : 'false'}
      className={`group flex items-center justify-between px-3 py-2 text-sm transition-colors ${
        isActive ? 'bg-surface-raised' : 'hover:bg-surface-raised/50'
      }`}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onSelect(conversation.id, conversation.title)}
      >
        <div className="truncate text-sm text-content-muted">{conversation.title}</div>
        <div className="text-xs text-content-faint">{formatDate(conversation.updated_at)}</div>
      </button>
      <button
        type="button"
        aria-label="Delete conversation"
        className="ml-2 shrink-0 rounded p-1 text-xs text-content-faint opacity-0 hover:bg-red-500/20 hover:text-red-400 group-hover:opacity-100"
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
