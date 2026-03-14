/**
 * src/hooks/useStream.ts
 *
 * React hook that drives the streaming chat UI. Fetches /api/chat, parses the
 * SSE response via parseSSEStream, and exposes accumulated state to components.
 *
 * Design decisions:
 * - AbortController stored in a ref, not state, so stop() never triggers a
 *   re-render and always refers to the latest in-flight controller.
 * - Each event type maps to a fine-grained setState call so React can batch
 *   contiguous delta events in concurrent mode (future-proofing with no cost).
 * - tokensAccRef/ttftRef mirror accumulated values synchronously so onComplete
 *   can receive the final result without depending on React state (which is
 *   async due to startTransition).
 */

import { startTransition, useEffect, useRef, useState } from 'react';
import type { SSEEvent } from '../lib/client/events';
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
  /** Accumulated reasoning text from thinking_delta events. Empty string when no
   *  thinking block was emitted. */
  thinkingText: string;
  /** True while thinking_block_start has fired but thinking_block_stop has not. */
  isThinking: boolean;
  /** Wall-clock duration (ms) of the thinking block; null until thinking_block_stop. */
  thinkingDurationMs: number | null;
  /** Timestamp (Date.now()) of the most recent content_block_delta. Null before
   *  the first content token. Used by useStallDetection to detect pauses. */
  lastTokenAt: number | null;
}

/** Called when a stream ends naturally (message_stop) or via user abort.
 *  Not called on error — the caller should inspect the returned `error` state. */
export type OnStreamComplete = (result: {
  tokens: string;
  ttft: number | null;
  thinkingText: string;
  thinkingDurationMs: number | null;
  /** Token usage from message_stop; null on abort (usage unavailable). */
  usage: { input_tokens: number; output_tokens: number } | null;
  /** Wall-clock duration (ms) from send() to stream end. */
  durationMs: number;
  /** Number of content_block_delta events received. */
  tokenCount: number;
  /** Server-assigned conversation ID; null on abort (message_stop not received). */
  conversationId: string | null;
}) => void;

/** Options for useStream. Allows injecting cross-cutting concerns (e.g.
 *  observability) without coupling the hook to specific context providers. */
export interface UseStreamOptions {
  /** Called for every SSE event parsed from the stream, before useStream's
   *  own switch/case processing. Enables observability instrumentation
   *  without modifying the hook's core logic. */
  onEvent?: (event: SSEEvent) => void;
}

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
  thinkingText: '',
  isThinking: false,
  thinkingDurationMs: null,
  lastTokenAt: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStream(options?: UseStreamOptions): UseStreamResult {
  const [state, setState] = useState<StreamState>(INITIAL_STATE);

  // Ref so stop() can abort the current controller without triggering a
  // render on assignment.
  const abortRef = useRef<AbortController | null>(null);

  // Accumulator refs: mirror the values written to state so onComplete can
  // receive the final result synchronously. startTransition makes React state
  // updates async, so we cannot read them immediately after the stream ends.
  const tokensAccRef = useRef('');
  const ttftRef = useRef<number | null>(null);
  const thinkingTextRef = useRef('');
  const thinkingDurationRef = useRef<number | null>(null);
  const thinkingStartRef = useRef<number | null>(null);
  const tokenCountRef = useRef(0);
  const usageRef = useRef<{ input_tokens: number; output_tokens: number } | null>(null);
  // Server-assigned conversation ID from message_stop; enables multi-turn
  // persistence by passing it back on subsequent send() calls.
  const conversationIdRef = useRef<string | null>(null);

  // Stable ref for onEvent so send() always sees the latest callback without
  // needing it as a closure dependency — avoids stale references. Synced in
  // an effect (not render) to avoid an impure render that the React Compiler
  // would flag.
  const onEventRef = useRef(options?.onEvent);
  useEffect(() => {
    onEventRef.current = options?.onEvent;
  }, [options?.onEvent]);

  const stop = () => {
    abortRef.current?.abort();
  };

  const send = async (
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
    thinkingTextRef.current = '';
    thinkingDurationRef.current = null;
    thinkingStartRef.current = null;
    tokenCountRef.current = 0;
    usageRef.current = null;
    conversationIdRef.current = null;

    // Build the onComplete result from accumulator refs.
    // durationMs is passed as a parameter because it's computed at call time.
    const buildResult = (durationMs: number) => ({
      tokens: tokensAccRef.current,
      ttft: ttftRef.current,
      thinkingText: thinkingTextRef.current,
      thinkingDurationMs: thinkingDurationRef.current,
      usage: usageRef.current,
      durationMs,
      tokenCount: tokenCountRef.current,
      conversationId: conversationIdRef.current,
    });

    // Record start time for TTFT calculation (wall-clock performance timer,
    // not Date.now(), so it isn't affected by system clock adjustments).
    const startTime = performance.now();
    let firstTokenReceived = false;
    // Tracks whether the stream terminated normally (message_stop or error event).
    // If the for-await loop exits without setting this, the connection dropped
    // mid-stream — a truncated response that needs explicit error handling.
    let receivedStop = false;

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

        // Notify the onEvent callback before processing — allows observability
        // hooks to see every raw SSE event without modifying useStream's logic.
        onEventRef.current?.(event);

        switch (event.type) {
          case 'content_block_delta': {
            // Mirror into ref so onComplete has the final value synchronously.
            tokensAccRef.current += event.delta.text;
            tokenCountRef.current += 1;
            // Date.now() (not performance.now()) because useStallDetection
            // compares this against future Date.now() calls — both sides must
            // use the same clock. performance.now() is reserved for duration
            // measurements (TTFT, thinking block) where monotonicity matters.
            const now = Date.now();
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
                lastTokenAt: now,
                ...(newTtft !== undefined ? { ttft: newTtft } : {}),
              }));
            });
            break;
          }

          case 'thinking_block_start':
            thinkingStartRef.current = performance.now();
            setState((prev) => ({ ...prev, isThinking: true }));
            break;

          case 'thinking_delta':
            thinkingTextRef.current += event.delta.text;
            // startTransition: same non-urgent priority as content deltas —
            // thinking text accumulation should not block user interactions.
            startTransition(() => {
              setState((prev) => ({
                ...prev,
                thinkingText: prev.thinkingText + event.delta.text,
              }));
            });
            break;

          case 'thinking_block_stop': {
            const duration =
              thinkingStartRef.current !== null
                ? performance.now() - thinkingStartRef.current
                : null;
            thinkingDurationRef.current = duration;
            setState((prev) => ({
              ...prev,
              isThinking: false,
              thinkingDurationMs: duration,
            }));
            break;
          }

          case 'message_stop':
            receivedStop = true;
            usageRef.current = event.usage;
            conversationIdRef.current = event.conversation_id;
            setState((prev) => ({ ...prev, isStreaming: false }));
            // React 18 automatic batching: onComplete's setState calls batch
            // with the isStreaming: false update above into one render, so
            // the finalized message appears atomically without a flicker frame.
            onComplete?.(buildResult(performance.now() - startTime));
            break;

          case 'error':
            receivedStop = true;
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              error: event.error.message,
              failedMessages: messages,
            }));
            // No onComplete on error — caller inspects the error state instead.
            break;

          // message_start, content_block_start/stop — no state changes needed.
          default:
            break;
        }
      }

      // If the stream closed without message_stop or error event (e.g., proxy
      // timeout, network reset, server crash after HTTP 200 committed), the
      // for-await loop exits silently. Detect this and surface it as an error
      // so the UI can stop the spinner and offer retry.
      if (!receivedStop && !controller.signal.aborted) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: 'Stream ended without completing (connection may have dropped)',
          failedMessages: messages,
        }));
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User-initiated cancellation is not an error — clear streaming flag
        // but leave tokens and error in their current state so partial content
        // remains visible.
        setState((prev) => ({ ...prev, isStreaming: false }));
        // Finalize partial content into history — abort is intentional, not
        // a failure, and the user should see what arrived before they stopped.
        // Note: if abort occurs mid-thinking, isThinking remains true in state
        // until the next send() resets via INITIAL_STATE. Consumers should
        // check isStreaming before relying on isThinking.
        onComplete?.(buildResult(performance.now() - startTime));
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
  };

  return { ...state, send, stop };
}
