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
    <div className="input-area">
      {onNewChat != null && (
        <button type="button" onClick={onNewChat} className="input-area__new-chat">
          New chat
        </button>
      )}
      <textarea
        className="input-area__textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Message input"
        rows={1}
      />
      {isStreaming ? (
        <button type="button" onClick={onStop} className="input-area__stop">
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isEmpty}
          className="input-area__submit"
          aria-label="Send message"
        >
          Send
        </button>
      )}
    </div>
  );
}
