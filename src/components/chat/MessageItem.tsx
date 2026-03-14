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
 * - Streaming indicator is a pulsing dot with role="status" and aria-label so
 *   screen readers announce "Streaming indicator" and tests can query by
 *   accessible label. When stalled (8s+ no tokens), the same dot shifts to a
 *   warmer/faster pulse and "Still working… Cancel" appears inline — no layout
 *   shift because the element stays in the footer.
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
  /** True when the stream has stalled (no tokens for 8s+). Shifts the pulsing
   *  dot to a warmer/faster pulse and shows "Still working… Cancel" inline. */
  isStalled?: boolean;
  /** Time-to-first-token in ms; badge is hidden when null or omitted. */
  ttft?: number | null;
  /** Called after clipboard write so the parent can emit observability events. */
  onCopy?: () => void;
  /** Called when user clicks Cancel on a stalled stream. */
  onCancel?: () => void;
}

// B2: w-fit makes user bubbles content-width instead of stretching to max-w.
const USER_BUBBLE =
  'rounded-2xl rounded-br-sm bg-surface-overlay px-4 py-2 text-content whitespace-pre-wrap';
// B3: Flat assistant messages — no background, no rounded corners. Subtle
// top padding separates turns visually without a bubble.
// min-h-[2.5rem]: prevents collapse during empty-content stream start.
// No whitespace-pre-wrap: react-markdown handles block layout; pre-wrap would
// preserve literal newlines from the raw Markdown source, breaking list formatting.
// text-[15px] splits the difference between text-sm (14px) and text-base (16px).
// leading-[1.7] matches the generous line-height used by production chat UIs.
const ASSISTANT_BUBBLE = 'px-1 py-2 text-[15px] leading-[1.7] text-content min-h-[2.5rem]';

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
  isStalled = false,
  ttft,
  onCopy,
  onCancel,
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
        <footer className="mt-1 flex items-center gap-2 text-xs text-content-faint">
          {ttft != null && <span className="font-mono">↯ {Math.round(ttft)}ms</span>}
          {/* B4: hover-only copy button with transient feedback */}
          <button
            type="button"
            className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100 hover:text-content-muted"
            aria-label="Copy response"
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <ClipboardIcon />}
          </button>
          {isStreaming && (
            <output aria-label="Streaming indicator" className="inline-flex items-center gap-2">
              {/* Unified pulsing dot: normal accent during streaming, warmer/faster when stalled */}
              <span
                className={`inline-block h-2 w-2 rounded-full animate-pulse ${
                  isStalled ? 'bg-[#d4a07e] [animation-duration:0.6s]' : 'bg-accent'
                }`}
              />
              {isStalled && (
                <>
                  <span className="text-content-faint">Still working…</span>
                  {onCancel && (
                    <button
                      type="button"
                      onClick={onCancel}
                      className="underline underline-offset-2 text-content-muted transition-colors hover:text-content"
                    >
                      Cancel
                    </button>
                  )}
                </>
              )}
            </output>
          )}
        </footer>
      )}
    </article>
  );
}
