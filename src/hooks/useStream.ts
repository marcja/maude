/**
 * src/hooks/useStream.ts
 *
 * React hook that drives the streaming chat UI. Fetches /api/chat, parses the
 * SSE response via parseSSEStream, and exposes accumulated state to components.
 *
 * Design decisions:
 * - AbortController stored in a ref, not state, so stop() never triggers a
 *   re-render and always refers to the latest in-flight controller without
 *   needing to appear in dependency arrays.
 * - send() is wrapped in useCallback with an empty dep array because it only
 *   reads from the ref and from its own arguments — no captured state.
 * - Each event type maps to a fine-grained setState call so React can batch
 *   contiguous delta events in concurrent mode (future-proofing with no cost).
 * - tokensAccRef/ttftRef mirror accumulated values synchronously so onComplete
 *   can receive the final result without depending on React state (which is
 *   async due to startTransition).
 */

import { startTransition, useCallback, useRef, useState } from 'react';
import { parseSSEStream } from '../lib/client/sseParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of a conversation message sent to the BFF.
 * Mirrors the server-side ChatMessage in modelAdapter.ts — defined here so
 * client code never imports from src/lib/server/.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamState {
  /** Accumulated text from all content_block_delta events. */
  tokens: string;
  /** True while a fetch is in progress and message_stop has not yet arrived. */
  isStreaming: boolean;
  /** Time-to-first-token in milliseconds; null until the first delta arrives. */
  ttft: number | null;
  /** Error message from an SSE error event or a fetch failure; null otherwise. */
  error: string | null;
  /** The messages array from the last failed send(), preserved so the caller can
   *  retry without reconstructing the context. Null when no error has occurred or
   *  after a successful send() clears the previous failure. Not set on abort —
   *  abort is intentional, not a failure worth retrying. */
  failedMessages: ChatMessage[] | null;
}

/** Called when a stream ends naturally (message_stop) or via user abort.
 *  Not called on error — the caller should inspect the returned `error` state. */
export type OnStreamComplete = (result: { tokens: string; ttft: number | null }) => void;

type UseStreamResult = StreamState & {
  send: (
    messages: ChatMessage[],
    conversationId?: string | null,
    onComplete?: OnStreamComplete
  ) => void;
  stop: () => void;
};

const INITIAL_STATE: StreamState = {
  tokens: '',
  isStreaming: false,
  ttft: null,
  error: null,
  failedMessages: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStream(): UseStreamResult {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);

  // Ref so stop() can abort the current controller without being a dependency
  // of the send useCallback and without triggering a render on assignment.
  const abortRef = useRef<AbortController | null>(null);

  // Accumulator refs: mirror the values written to state so onComplete can
  // receive the final result synchronously. startTransition makes React state
  // updates async, so we cannot read them immediately after the stream ends.
  const tokensAccRef = useRef('');
  const ttftRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (
      messages: ChatMessage[],
      conversationId?: string | null,
      onComplete?: OnStreamComplete
    ) => {
      // Cancel any in-flight request before starting a new one so a user who
      // rapidly submits does not receive interleaved responses.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Reset to a clean streaming state synchronously — components see
      // isStreaming: true on the very next render after send() is called.
      setState({ ...INITIAL_STATE, isStreaming: true });
      tokensAccRef.current = '';
      ttftRef.current = null;

      // Record start time for TTFT calculation (wall-clock performance timer,
      // not Date.now(), so it isn't affected by system clock adjustments).
      const startTime = performance.now();
      let firstTokenReceived = false;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, conversationId: conversationId ?? null }),
          signal: controller.signal,
        });

        // Check response.ok before attempting SSE parse. Without this, a
        // reverse proxy returning a 502 HTML error page would be silently
        // swallowed by the SSE parser (no lines start with "data:"), and the
        // user would see no error and no response — a confusing failure mode.
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Server returned HTTP ${response.status}${text ? `: ${text}` : ''}`);
        }

        if (!response.body) throw new Error('Response body is null');

        for await (const event of parseSSEStream(response.body)) {
          // Check abort between events so we don't process stale data after
          // the user has already clicked Stop and a new request may be starting.
          if (controller.signal.aborted) break;

          switch (event.type) {
            case 'content_block_delta': {
              // Mirror into ref so onComplete has the final value synchronously.
              tokensAccRef.current += event.delta.text;
              // TTFT is measured at first visible token, not at message_start,
              // because message_start arrives before any content and would give
              // a misleadingly short latency number.
              let newTtft: number | undefined;
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                newTtft = performance.now() - startTime;
                ttftRef.current = newTtft;
              }
              // startTransition marks token accumulation as non-urgent so the
              // browser can prioritize user interactions (Stop button clicks,
              // scroll events) over rendering the next token. Without this,
              // heavy streaming can make the UI feel unresponsive to input.
              startTransition(() => {
                setState((prev) => ({
                  ...prev,
                  tokens: prev.tokens + event.delta.text,
                  ...(newTtft !== undefined ? { ttft: newTtft } : {}),
                }));
              });
              break;
            }

            case 'message_stop':
              setState((prev) => ({ ...prev, isStreaming: false }));
              // React 18 automatic batching: onComplete's setState calls batch
              // with the isStreaming: false update above into one render, so
              // the finalized message appears atomically without a flicker frame.
              onComplete?.({ tokens: tokensAccRef.current, ttft: ttftRef.current });
              break;

            case 'error':
              setState((prev) => ({
                ...prev,
                isStreaming: false,
                error: event.error.message,
                failedMessages: messages,
              }));
              // No onComplete on error — caller inspects the error state instead.
              break;

            // message_start, content_block_start/stop, thinking_* — no state
            // changes at this layer for the minimal hook; Phase 2 adds thinking.
            default:
              break;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User-initiated cancellation is not an error — clear streaming flag
          // but leave tokens and error in their current state so partial content
          // remains visible.
          setState((prev) => ({ ...prev, isStreaming: false }));
          // Finalize partial content into history — abort is intentional, not
          // a failure, and the user should see what arrived before they stopped.
          onComplete?.({ tokens: tokensAccRef.current, ttft: ttftRef.current });
        } else {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: err instanceof Error ? err.message : 'Unknown error',
            failedMessages: messages,
          }));
        }
      } finally {
        // Release the controller reference so the AbortController can be GC'd
        // immediately after the request lifecycle ends (successful or not).
        // Without this, it would linger until the next send() overwrites the ref.
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    []
  );

  return { ...state, send, stop };
}
