/**
 * src/hooks/useObservabilityEvents.ts
 *
 * Composition hook that bridges useStream lifecycle events to
 * ObservabilityContext. Wraps useStream and emits observability events
 * (message_sent, stream_started, stream_completed, etc.) at the right
 * moments without coupling useStream itself to the context provider.
 *
 * Design decisions:
 * - Separate hook (not inlined in useStream) so useStream stays context-free
 *   and its 40+ tests don't need an ObservabilityProvider wrapper.
 * - onEvent callback (dependency injection) lets useStream forward raw SSE
 *   events without knowing what consumes them.
 * - Refs for mutable tracking (requestId, firstToken, tokenCount, startTime,
 *   finalized) avoid re-renders and stale closure issues.
 * - The `finalized` ref prevents duplicate terminal events — e.g. stop()
 *   called after message_stop should not emit both stream_completed and
 *   stream_cancelled.
 */

import { useRef } from 'react';
import { useObservability } from '../context/ObservabilityContext';
import type { SSEEvent } from '../lib/client/events';
import type { ChatMessage } from './useStream';
import { useStream } from './useStream';
import type { OnStreamComplete } from './useStream';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for useStream that also emits observability events.
 * Returns the same interface so the chat page can swap imports seamlessly.
 */
export function useObservabilityEvents() {
  const { addEvent, startRequest, updateRequest, setSystemPrompt } = useObservability();

  // Mutable tracking — refs avoid re-renders and stale closure issues.
  const requestIdRef = useRef<string | null>(null);
  const firstTokenRef = useRef(false);
  const tokenCountRef = useRef(0);
  const startTimeRef = useRef(0);
  // Prevents duplicate terminal events (e.g. stop() after message_stop).
  const finalizedRef = useRef(false);
  // Track thinking start time for thinking_completed payload.
  const thinkingStartRef = useRef<number | null>(null);

  // onEvent callback — forwarded to useStream via options. Processes raw
  // SSE events and dispatches observability events at lifecycle boundaries.
  const onEvent = (event: SSEEvent) => {
    const reqId = requestIdRef.current;

    switch (event.type) {
      case 'message_start': {
        if ('prompt_used' in event && event.prompt_used) {
          setSystemPrompt(event.prompt_used);
        }
        break;
      }

      case 'content_block_delta': {
        tokenCountRef.current += 1;
        if (!firstTokenRef.current) {
          firstTokenRef.current = true;
          const ttft = performance.now() - startTimeRef.current;
          const ttftRounded = Math.round(ttft);
          addEvent({
            type: 'stream_started',
            payload: `${ttftRounded}ms TTFT`,
            timestamp: Date.now(),
            requestId: reqId,
          });
          if (reqId) {
            updateRequest(reqId, { ttft });
          }
        }
        break;
      }

      case 'thinking_block_start': {
        thinkingStartRef.current = performance.now();
        addEvent({
          type: 'thinking_started',
          payload: '',
          timestamp: Date.now(),
          requestId: reqId,
        });
        break;
      }

      case 'thinking_block_stop': {
        const duration =
          thinkingStartRef.current !== null
            ? Math.round(performance.now() - thinkingStartRef.current)
            : 0;
        addEvent({
          type: 'thinking_completed',
          payload: `${duration}ms`,
          timestamp: Date.now(),
          requestId: reqId,
        });
        thinkingStartRef.current = null;
        break;
      }

      case 'message_stop': {
        finalizedRef.current = true;
        const durationMs = performance.now() - startTimeRef.current;
        const durationSec = (durationMs / 1000).toFixed(1);
        const outputTokens = event.usage.output_tokens;
        const throughput = durationMs > 0 ? (outputTokens / durationMs) * 1000 : 0;

        addEvent({
          type: 'stream_completed',
          payload: `${outputTokens} tok, ${durationSec}s`,
          timestamp: Date.now(),
          requestId: reqId,
        });
        if (reqId) {
          updateRequest(reqId, {
            status: 'completed',
            throughput,
            inputTokens: event.usage.input_tokens,
            outputTokens,
            durationMs,
          });
        }
        break;
      }

      case 'error': {
        finalizedRef.current = true;
        const message = event.error.message.slice(0, 80);
        addEvent({
          type: 'stream_error',
          payload: message,
          timestamp: Date.now(),
          requestId: reqId,
        });
        if (reqId) {
          updateRequest(reqId, { status: 'error' });
        }
        break;
      }

      default:
        break;
    }
  };

  const streamResult = useStream({ onEvent });

  // Wrap send() to emit message_sent and startRequest before delegating.
  const wrappedSend = (
    messages: ChatMessage[],
    conversationId?: string | null,
    onComplete?: OnStreamComplete
  ) => {
    // Reset tracking refs for the new request.
    firstTokenRef.current = false;
    tokenCountRef.current = 0;
    startTimeRef.current = performance.now();
    finalizedRef.current = false;
    thinkingStartRef.current = null;

    const reqId = crypto.randomUUID();
    requestIdRef.current = reqId;

    // Compute char count from the last user message (matches SPEC: "{n} chars").
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    const charCount = lastUserMsg?.content.length ?? 0;

    addEvent({
      type: 'message_sent',
      payload: `${charCount} chars`,
      timestamp: Date.now(),
      requestId: reqId,
    });

    startRequest({
      id: reqId,
      status: 'streaming',
      timestamp: Date.now(),
      ttft: null,
      throughput: null,
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
    });

    streamResult.send(messages, conversationId, onComplete);
  };

  // Wrap stop() to emit stream_cancelled if the stream hasn't already finalized.
  const wrappedStop = () => {
    if (!finalizedRef.current && requestIdRef.current) {
      finalizedRef.current = true;
      const reqId = requestIdRef.current;
      const durationMs = performance.now() - startTimeRef.current;

      addEvent({
        type: 'stream_cancelled',
        payload: `${tokenCountRef.current} tok rcvd`,
        timestamp: Date.now(),
        requestId: reqId,
      });
      updateRequest(reqId, { status: 'cancelled', durationMs });
    }
    streamResult.stop();
  };

  return {
    ...streamResult,
    send: wrappedSend,
    stop: wrappedStop,
  };
}
