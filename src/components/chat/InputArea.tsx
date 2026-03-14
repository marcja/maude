'use client';

/**
 * src/components/chat/InputArea.tsx
 *
 * The chat input bar: textarea + action row below. Two-row layout matching
 * modern chat conventions (Claude.ai, Perplexity, etc.):
 *   Row 1: full-width textarea where the user types
 *   Row 2: action buttons (send/stop) right-aligned
 *
 * Design decisions:
 * - Controlled textarea via useState so we can clear it after submit without
 *   reaching into the DOM imperatively.
 * - Enter submits; Shift+Enter lets the browser insert a newline naturally by
 *   only calling preventDefault on Enter without Shift. This is the universal
 *   chat convention users expect.
 * - Stop replaces Send during streaming so there is always exactly one primary
 *   action button. Keeping them mutually exclusive avoids the confusion of a
 *   disabled Send sitting next to an active Stop.
 * - handleSubmit trims the value before passing it upstream — trailing newlines
 *   from accidental Shift+Enter presses should not reach the model.
 * - Send button is a circular up-arrow icon (Perplexity convention) rather than
 *   a text "Send" button.
 */

import { useLayoutEffect, useRef, useState } from 'react';

interface InputAreaProps {
  /** Drives Stop/Send toggle and guards Enter submit against racing sends. */
  isStreaming: boolean;
  /** Called with the trimmed textarea value; parent builds ChatMessage[]. */
  onSubmit: (value: string) => void;
  /** Delegates to useStream().stop() which calls AbortController.abort(). */
  onStop: () => void;
  /** Starts a fresh conversation; optional so callers can omit until ready. */
  onNewChat?: () => void;
}

export function InputArea({ isStreaming, onSubmit, onStop }: InputAreaProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize: reset to one row then grow to fit content. The max-h-32
  // CSS class caps the visual height; beyond that the textarea scrolls
  // internally. useLayoutEffect (not useEffect) because this is a synchronous
  // DOM measurement + mutation that must happen before the browser paints —
  // useEffect would cause a visible frame with the wrong textarea height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is an intentional trigger dep — the effect must re-run on every keystroke to recalculate textarea height, even though the value itself is not read in the effect body.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    // Guard: never fire onSubmit with blank input or while a stream is live.
    // The isStreaming guard is redundant with the disabled button but provides
    // a safety net for keyboard-driven submit paths.
    if (!trimmed || isStreaming) return;
    onSubmit(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter without Shift is the submit shortcut. preventDefault stops the
      // browser from appending a newline before we clear the field.
      e.preventDefault();
      handleSubmit();
    }
    // Shift+Enter: no preventDefault — browser inserts the newline naturally.
  };

  const isEmpty = value.trim().length === 0;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-col rounded-xl border border-edge bg-surface-raised transition-colors focus-within:border-edge-hover">
        {/* Row 1: full-width textarea */}
        <textarea
          ref={textareaRef}
          className="max-h-32 min-h-[44px] w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-content placeholder:text-content-faint focus:outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          aria-label="Message input"
          rows={1}
        />

        {/* Row 2: action buttons right-aligned */}
        <div className="flex items-center justify-end px-3 pb-2">
          {/* Send/Stop share identical h-8 w-8 circular shape so the button
               doesn't shift position when toggling between states. */}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400 transition-colors hover:bg-red-500/30 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              aria-label="Stop"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <title>Stop</title>
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isEmpty}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/90 text-surface transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              aria-label="Send message"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <title>Send</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {/* Keyboard shortcut hint — invisible during streaming but still occupies
           space so the input area height doesn't shift when toggling. */}
      <p
        className={`mt-1.5 text-center text-xs ${isStreaming ? 'text-transparent' : 'text-content-faint'}`}
      >
        Enter to send, Shift+Enter for newline
      </p>
    </div>
  );
}
