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
 */

import { useCallback, useRef, useState } from 'react';
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
}

type UseStreamResult = StreamState & {
  send: (messages: ChatMessage[], conversationId?: string | null) => void;
  stop: () => void;
};

const INITIAL_STATE: StreamState = {
  tokens: '',
  isStreaming: false,
  ttft: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStream(): UseStreamResult {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);

  // Ref so stop() can abort the current controller without being a dependency
  // of the send useCallback and without triggering a render on assignment.
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async (messages: ChatMessage[], conversationId?: string | null) => {
    // Cancel any in-flight request before starting a new one so a user who
    // rapidly submits does not receive interleaved responses.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset to a clean streaming state synchronously — components see
    // isStreaming: true on the very next render after send() is called.
    setState({ ...INITIAL_STATE, isStreaming: true });

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

      if (!response.body) throw new Error('Response body is null');

      for await (const event of parseSSEStream(response.body)) {
        // Check abort between events so we don't process stale data after
        // the user has already clicked Stop and a new request may be starting.
        if (controller.signal.aborted) break;

        switch (event.type) {
          case 'content_block_delta': {
            // TTFT is measured at first visible token, not at message_start,
            // because message_start arrives before any content and would give
            // a misleadingly short latency number.
            if (!firstTokenReceived) {
              firstTokenReceived = true;
              const ttft = performance.now() - startTime;
              setState((prev) => ({
                ...prev,
                ttft,
                tokens: prev.tokens + event.delta.text,
              }));
            } else {
              setState((prev) => ({ ...prev, tokens: prev.tokens + event.delta.text }));
            }
            break;
          }

          case 'message_stop':
            setState((prev) => ({ ...prev, isStreaming: false }));
            break;

          case 'error':
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              error: event.error.message,
            }));
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
      } else {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: err instanceof Error ? err.message : 'Unknown error',
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
  }, []);

  return { ...state, send, stop };
}
