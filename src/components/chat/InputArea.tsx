'use client';

/**
 * src/components/chat/InputArea.tsx
 *
 * The chat input bar: textarea, Send button, and a Stop button that swaps in
 * during streaming. Purely presentational — all state and callbacks come from
 * props so T10 can wire them to useStream without this component importing the
 * hook directly. This matches the MessageItem pattern and keeps tests simple
 * (no MSW, no renderHook needed).
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
 * - onNewChat is optional: T10 will supply it; future callers can omit it.
 */

import { useState } from 'react';

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

export function InputArea({ isStreaming, onSubmit, onStop, onNewChat }: InputAreaProps) {
  const [value, setValue] = useState('');

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
    <div className="flex items-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
      {onNewChat != null && (
        <button
          type="button"
          onClick={onNewChat}
          className="shrink-0 appearance-none rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-200"
        >
          New chat
        </button>
      )}
      <textarea
        className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Message input"
        rows={1}
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="shrink-0 rounded-xl bg-red-500 px-4 py-2 text-sm text-white transition-colors hover:bg-red-600"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isEmpty}
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send message"
        >
          Send
        </button>
      )}
    </div>
  );
}
