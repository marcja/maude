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

import { useState } from 'react';
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

// B2: w-fit makes user bubbles content-width instead of stretching to max-w.
const USER_BUBBLE =
  'rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white whitespace-pre-wrap';
// B3: Flat assistant messages — no background, no rounded corners. Subtle
// top padding separates turns visually without a bubble.
// min-h-[2.5rem]: prevents collapse during empty-content stream start.
const ASSISTANT_BUBBLE = 'px-1 py-2 text-gray-900 whitespace-pre-wrap min-h-[2.5rem]';

/** Inline clipboard SVG icon (16×16). */
function ClipboardIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <title>Copy</title>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2M8 5a2 2 0 012-2h4a2 2 0 012 2M8 5a2 2 0 002 2h4a2 2 0 002-2"
      />
    </svg>
  );
}

/** Inline checkmark SVG icon (16×16). */
function CheckIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <title>Copied</title>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function MessageItem({
  sender,
  content,
  isStreaming = false,
  ttft,
  onCopy,
}: MessageItemProps) {
  const isUser = sender === 'user';
  // B4: transient "Copied!" confirmation — resets after 2s.
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(content);
    onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    // B2: max-w-[80%] w-fit keeps user bubbles content-sized.
    // `group` enables B4 hover-only copy button.
    <article className={`group mb-3 ${isUser ? 'ml-auto max-w-[80%] w-fit' : 'mr-auto max-w-2xl'}`}>
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
          {/* B4: hover-only copy button with transient feedback */}
          <button
            type="button"
            className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 hover:text-gray-600"
            aria-label="Copy response"
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <ClipboardIcon />}
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
