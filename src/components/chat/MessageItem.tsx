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
 * - Plain text rendering in T07; T13 upgrades content to react-markdown.
 */

interface MessageItemProps {
  /** Who sent the message. Named 'sender' (not 'role') to avoid colliding with
   * the HTML ARIA 'role' attribute, which biome checks on all JSX props. */
  sender: 'user' | 'assistant';
  content: string;
  /** True while the assistant stream is in progress. */
  isStreaming?: boolean;
  /** Time-to-first-token in ms; badge is hidden when null or omitted. */
  ttft?: number | null;
}

export function MessageItem({ sender, content, isStreaming = false, ttft }: MessageItemProps) {
  return (
    <article className={`message message--${sender}`}>
      <p className="message__content">{content}</p>
      {sender === 'assistant' && (
        <footer className="message__footer">
          {ttft != null && <span className="message__ttft-badge">↯ {Math.round(ttft)}ms</span>}
          <button
            type="button"
            className="message__copy-btn"
            aria-label="Copy response"
            onClick={() => {
              // Fire-and-forget: no UI feedback in T07; a future task adds
              // a transient "Copied!" confirmation state.
              void navigator.clipboard.writeText(content);
            }}
          >
            Copy
          </button>
          {isStreaming && (
            <span role="status" aria-label="Streaming indicator" className="message__spinner" />
          )}
        </footer>
      )}
    </article>
  );
}
