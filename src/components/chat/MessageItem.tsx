'use client';

/**
 * src/components/chat/MessageItem.tsx
 *
 * Renders a single chat message. Purely presentational — receives all data
 * as props so the parent controls state and this component stays testable
 * without mocking hooks.
 *
 * Design decisions:
 * - role === 'user' renders content only; no badge, copy, or spinner because
 *   those concepts apply to assistant responses, not user input.
 * - TTFT badge uses the ↯ glyph ("thunderbolt-down") from SPEC.md §4.2.
 * - Copy button writes to navigator.clipboard, which is async but fire-and-
 *   forget here — there is no confirmed/error UI in T07 (T-future adds that).
 * - Spinner is rendered as a visually-spinning span with role="status" and
 *   aria-label so screen readers announce "Streaming indicator" and tests can
 *   query by accessible label without coupling to CSS class names.
 * - T13 upgraded assistant content from plain text to StreamingMarkdown for
 *   rich Markdown rendering. User messages stay as plain text (they're user
 *   input, not Markdown).
 */

import { StreamingMarkdown } from './StreamingMarkdown';

interface MessageItemProps {
  /** Who sent the message. Named 'sender' (not 'role') to avoid colliding with
   * the HTML ARIA 'role' attribute, which biome checks on all JSX props. */
  sender: 'user' | 'assistant';
  content: string;
  /** True while the assistant stream is in progress. */
  isStreaming?: boolean;
  /** Time-to-first-token in ms; badge is hidden when null or omitted. */
  ttft?: number | null;
  /** Called after clipboard write so the parent can emit observability events. */
  onCopy?: () => void;
}

// Named constants keep the JSX ternary readable and make it easy to find all
// styling for a given bubble variant in one place.
const USER_BUBBLE =
  'rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white whitespace-pre-wrap';
// min-h-[2.5rem]: prevents the bubble from collapsing to near-zero height
// while content is empty at the start of a stream.
const ASSISTANT_BUBBLE =
  'rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-2 text-gray-900 whitespace-pre-wrap min-h-[2.5rem]';

export function MessageItem({
  sender,
  content,
  isStreaming = false,
  ttft,
  onCopy,
}: MessageItemProps) {
  const isUser = sender === 'user';
  return (
    <article className={`mb-3 max-w-2xl ${isUser ? 'ml-auto' : 'mr-auto'}`}>
      {isUser ? (
        <p className={USER_BUBBLE}>{content}</p>
      ) : (
        <div className={ASSISTANT_BUBBLE}>
          <StreamingMarkdown content={content} />
        </div>
      )}
      {!isUser && (
        <footer className="mt-1 flex items-center gap-2 text-xs text-gray-400">
          {ttft != null && <span className="font-mono">↯ {Math.round(ttft)}ms</span>}
          <button
            type="button"
            className="cursor-pointer transition-colors hover:text-gray-600"
            aria-label="Copy response"
            onClick={() => {
              // Fire-and-forget: no UI feedback in T07; a future task adds
              // a transient "Copied!" confirmation state.
              void navigator.clipboard.writeText(content);
              onCopy?.();
            }}
          >
            Copy
          </button>
          {isStreaming && (
            <span
              role="status"
              aria-label="Streaming indicator"
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500"
            />
          )}
        </footer>
      )}
    </article>
  );
}
