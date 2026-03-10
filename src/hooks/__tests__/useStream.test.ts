/**
 * @jest-environment ./jest-environment-with-fetch.js
 *
 * Custom environment required because MSW 2.x references WinterCG fetch
 * globals (Response, Request) at module-load time, which jest-environment-jsdom
 * doesn't provide. The custom env injects Node 18+ fetch globals before any
 * module is loaded while preserving jsdom for React Testing Library.
 */

/**
 * src/hooks/__tests__/useStream.test.ts
 *
 * Tests for the useStream hook using MSW to intercept /api/chat.
 * No Ollama instance is required — MSW replaces the network layer entirely.
 *
 * Why renderHook + waitFor: the hook drives async state transitions (fetch →
 * parse events → setState). React batches updates asynchronously, so we must
 * poll with waitFor rather than asserting synchronously after act().
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { SSEEvent } from '../../lib/client/events';
import { createSyncHandler } from '../../mocks/handlerFactory';
import { holdHandler } from '../../mocks/handlers/hold';
import { midstreamErrorHandler } from '../../mocks/handlers/midstream-error';
import { normalHandler } from '../../mocks/handlers/normal';
import { thinkingHandler } from '../../mocks/handlers/thinking';
import { truncatedHandler } from '../../mocks/handlers/truncated';
import { encodeEvent } from '../../mocks/utils';
import type { OnStreamComplete } from '../useStream';
import { useStream } from '../useStream';

// ---------------------------------------------------------------------------
// MSW server — shared across all tests in this file
// ---------------------------------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Suite 1: Token accumulation and TTFT
// ---------------------------------------------------------------------------

describe('useStream — token accumulation', () => {
  it('accumulates content_block_delta tokens into the tokens field', async () => {
    server.use(normalHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hello' }]);
    });

    // The normal handler emits "Hello" + " world"
    await waitFor(() => expect(result.current.tokens).toBe('Hello world'));
  });

  it('records a non-null TTFT after the first token arrives', async () => {
    server.use(normalHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.ttft).not.toBeNull());
    // TTFT must be a non-negative number (ms)
    expect(typeof result.current.ttft).toBe('number');
    expect(result.current.ttft).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: message_stop finalizes the stream
// ---------------------------------------------------------------------------

describe('useStream — message_stop', () => {
  it('sets isStreaming to false when message_stop is received', async () => {
    server.use(normalHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    // Ensure the full content arrived, not just a premature stop
    expect(result.current.tokens).toBe('Hello world');
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: error event sets error state
// ---------------------------------------------------------------------------

describe('useStream — error events', () => {
  it('sets error field and clears isStreaming on error event', async () => {
    server.use(midstreamErrorHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isStreaming).toBe(false);
    // Exact message ensures the post-loop truncation guard doesn't overwrite
    // the SSE error event's own message.
    expect(result.current.error).toBe('Stream failed');
    // Partial tokens received before the error should be present
    expect(result.current.tokens).toBe('Part');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: abort controller / Stop action
// ---------------------------------------------------------------------------

describe('useStream — stop()', () => {
  it('sets isStreaming to false when stop() is called mid-stream', async () => {
    // holdHandler holds the stream open and propagates the AbortSignal so that
    // reader.read() inside parseSSEStream rejects, reaching the AbortError catch.
    server.use(holdHandler);

    const { result } = renderHook(() => useStream());

    // Fire send — don't await; it runs async
    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    // isStreaming flips true synchronously inside send() before the first await
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    // Abort the in-flight request
    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    // An aborted stream is not an error — error field stays null
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: onComplete callback
// ---------------------------------------------------------------------------

describe('useStream — onComplete callback', () => {
  it('calls onComplete with final tokens and ttft when message_stop arrives', async () => {
    server.use(normalHandler);

    const { result } = renderHook(() => useStream());
    const onComplete = jest.fn();

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hello' }], null, onComplete);
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // jest.fn() types mock.calls as any[][] — cast to the known callback shape
    const callArg = onComplete.mock.calls[0][0] as Parameters<OnStreamComplete>[0];
    expect(callArg.tokens).toBe('Hello world');
    expect(typeof callArg.ttft).toBe('number');
  });

  it('calls onComplete with partial tokens when stop() is called mid-stream', async () => {
    server.use(holdHandler);

    const { result } = renderHook(() => useStream());
    const onComplete = jest.fn();

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }], null, onComplete);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    act(() => {
      result.current.stop();
    });

    // Abort is treated as completion (not error) — onComplete fires with whatever arrived.
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // jest.fn() types mock.calls as any[][] — cast to the known callback shape
    const callArg = onComplete.mock.calls[0][0] as Parameters<OnStreamComplete>[0];
    expect(typeof callArg.tokens).toBe('string');
  });

  it('cancels the previous in-flight request when send() is called a second time', async () => {
    // First call stalls; second call must abort the first controller
    // (abortRef.current?.abort()) and complete successfully with the normal handler.
    server.use(holdHandler);

    const { result } = renderHook(() => useStream());

    // Start the first request (stalls).
    act(() => {
      void result.current.send([{ role: 'user', content: 'first' }]);
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    // Second send() must abort the first and start fresh.
    server.use(normalHandler);
    act(() => {
      void result.current.send([{ role: 'user', content: 'second' }]);
    });

    await waitFor(() => expect(result.current.tokens).toBe('Hello world'));
    expect(result.current.isStreaming).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: non-AbortError network failure
// ---------------------------------------------------------------------------

describe('useStream — network error', () => {
  it('sets error state when fetch rejects with a non-abort error', async () => {
    // HttpResponse.error() causes MSW to simulate a network-level failure,
    // making fetch() reject with a TypeError. This exercises the non-AbortError
    // catch branch in useStream (lines 187-192).
    server.use(http.post('/api/chat', () => HttpResponse.error()));

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isStreaming).toBe(false);
    expect(typeof result.current.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Suite 7: non-2xx HTTP response
// ---------------------------------------------------------------------------

describe('useStream — non-2xx response', () => {
  it('sets error state when server returns 500 with text body', async () => {
    server.use(
      http.post('/api/chat', () => new HttpResponse('Internal Server Error', { status: 500 }))
    );

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toContain('500');
  });

  it('sets error state when server returns 502 with HTML body', async () => {
    server.use(
      http.post(
        '/api/chat',
        () => new HttpResponse('<html><body>Bad Gateway</body></html>', { status: 502 })
      )
    );

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toContain('502');
  });

  it('does not call onComplete on non-2xx response', async () => {
    server.use(http.post('/api/chat', () => new HttpResponse('Bad Request', { status: 400 })));

    const { result } = renderHook(() => useStream());
    const onComplete = jest.fn();

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }], null, onComplete);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(onComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 7b: onComplete not called on errors
// ---------------------------------------------------------------------------

describe('useStream — onComplete skipped on error', () => {
  it('does not call onComplete on SSE error event', async () => {
    server.use(midstreamErrorHandler);

    const { result } = renderHook(() => useStream());
    const onComplete = jest.fn();

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }], null, onComplete);
    });

    // SSE error events are failures, not completions — onComplete must not fire.
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(onComplete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 8: initial state
// ---------------------------------------------------------------------------

describe('useStream — initial state', () => {
  it('starts with empty/null state before send() is called', () => {
    const { result } = renderHook(() => useStream());

    expect(result.current.tokens).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.ttft).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.failedMessages).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 9: failedMessages for retry
// ---------------------------------------------------------------------------

describe('useStream — failedMessages', () => {
  it('preserves the original messages on non-abort error', async () => {
    server.use(http.post('/api/chat', () => HttpResponse.error()));

    const { result } = renderHook(() => useStream());
    const messages = [{ role: 'user' as const, content: 'Hi' }];

    act(() => {
      void result.current.send(messages);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.failedMessages).toEqual(messages);
  });

  it('preserves messages on SSE error event', async () => {
    server.use(midstreamErrorHandler);

    const { result } = renderHook(() => useStream());
    const messages = [{ role: 'user' as const, content: 'Hi' }];

    act(() => {
      void result.current.send(messages);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.failedMessages).toEqual(messages);
  });

  it('preserves messages on non-2xx response', async () => {
    server.use(
      http.post('/api/chat', () => new HttpResponse('Internal Server Error', { status: 500 }))
    );

    const { result } = renderHook(() => useStream());
    const messages = [{ role: 'user' as const, content: 'Hi' }];

    act(() => {
      void result.current.send(messages);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.failedMessages).toEqual(messages);
  });

  it('does not set failedMessages on abort (user-initiated stop)', async () => {
    server.use(holdHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.failedMessages).toBeNull();
  });

  it('clears failedMessages when a new send() succeeds', async () => {
    // First: trigger an error to populate failedMessages
    server.use(http.post('/api/chat', () => HttpResponse.error()));

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });
    await waitFor(() => expect(result.current.failedMessages).not.toBeNull());

    // Second: successful send clears failedMessages
    server.use(normalHandler);
    act(() => {
      void result.current.send([{ role: 'user', content: 'Retry' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.failedMessages).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 10: thinking events
// ---------------------------------------------------------------------------

describe('useStream — thinking events', () => {
  it('accumulates thinking_delta text into thinkingText', async () => {
    server.use(thinkingHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Think' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.thinkingText).toBe('Step 1: analyze.\nStep 2: compute.\n');
    // Thinking text must NOT leak into the content tokens accumulator
    expect(result.current.tokens).toBe('The answer is 42.');
  });

  it('isThinking is false after stream completes with thinking block', async () => {
    // Note: the synchronous handler completes in a single microtask, so we can
    // only observe the final state. The intermediate isThinking=true state is
    // not observable without a delayed handler — accepted trade-off.
    server.use(thinkingHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Think' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.isThinking).toBe(false);
  });

  it('records thinkingDurationMs after thinking_block_stop', async () => {
    server.use(thinkingHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Think' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.thinkingDurationMs).not.toBeNull();
    expect(typeof result.current.thinkingDurationMs).toBe('number');
    // Duration should be non-negative (synchronous handler → very small but >= 0)
    expect(result.current.thinkingDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('thinkingText is empty when no thinking events occur', async () => {
    server.use(normalHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.thinkingText).toBe('');
    expect(result.current.isThinking).toBe(false);
    expect(result.current.thinkingDurationMs).toBeNull();
  });

  it('passes thinkingText and thinkingDurationMs to onComplete', async () => {
    server.use(thinkingHandler);

    const { result } = renderHook(() => useStream());
    const onComplete = jest.fn();

    act(() => {
      void result.current.send([{ role: 'user', content: 'Think' }], null, onComplete);
    });

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    // jest.fn() types mock.calls as any[][] — cast to the known callback shape
    const callArg = onComplete.mock.calls[0][0] as Parameters<OnStreamComplete>[0];
    expect(callArg.thinkingText).toBe('Step 1: analyze.\nStep 2: compute.\n');
    expect(typeof callArg.thinkingDurationMs).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Suite 11: lastTokenAt
// ---------------------------------------------------------------------------

describe('useStream — lastTokenAt', () => {
  it('sets lastTokenAt to a non-null timestamp after content_block_delta', async () => {
    server.use(normalHandler);

    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.lastTokenAt).not.toBeNull();
    expect(typeof result.current.lastTokenAt).toBe('number');
  });

  it('lastTokenAt is null before first content delta', () => {
    const { result } = renderHook(() => useStream());
    expect(result.current.lastTokenAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 12: conversationId passthrough
// ---------------------------------------------------------------------------

describe('useStream — conversationId', () => {
  // Helper: MSW handler that captures the request body and returns a minimal
  // complete SSE stream, so tests can inspect what the hook serialized.
  function useBodyCapturingHandler() {
    let capturedBody: Record<string, unknown> | null = null;
    const encoder = new TextEncoder();
    server.use(
      http.post('/api/chat', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        const events: SSEEvent[] = [
          { type: 'message_start', message_id: 'capture-test' },
          { type: 'message_stop', usage: { input_tokens: 1, output_tokens: 1 } },
        ];
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const event of events) {
              controller.enqueue(encoder.encode(encodeEvent(event)));
            }
            controller.close();
          },
        });
        return new HttpResponse(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      })
    );
    return () => capturedBody;
  }

  it('sends conversationId in the request body when provided', async () => {
    const getCapturedBody = useBodyCapturingHandler();

    const { result } = renderHook(() => useStream());
    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }], 'conv-123');
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(getCapturedBody()).not.toBeNull();
    expect(getCapturedBody()?.conversationId).toBe('conv-123');
  });

  it('sends null conversationId when omitted', async () => {
    const getCapturedBody = useBodyCapturingHandler();

    const { result } = renderHook(() => useStream());
    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(getCapturedBody()).not.toBeNull();
    // When conversationId is omitted, the hook serializes it as null
    expect(getCapturedBody()?.conversationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 13: state reset between sends
// ---------------------------------------------------------------------------

describe('useStream — state reset between sends', () => {
  it('resets tokens, ttft, and thinking state on subsequent send()', async () => {
    server.use(normalHandler);
    const { result } = renderHook(() => useStream());

    // First send — accumulates tokens
    act(() => {
      void result.current.send([{ role: 'user', content: 'first' }]);
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.tokens).toBe('Hello world');
    expect(result.current.ttft).not.toBeNull();

    // Second send — tokens should reset to fresh accumulation, not append
    act(() => {
      void result.current.send([{ role: 'user', content: 'second' }]);
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.tokens).toBe('Hello world');
    expect(result.current.error).toBeNull();
  });

  it('resets error state when a new send() starts', async () => {
    // First: trigger an error
    server.use(http.post('/api/chat', () => HttpResponse.error()));
    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'fail' }]);
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    // Second: error should clear immediately when send() starts, before response arrives
    server.use(holdHandler);
    act(() => {
      void result.current.send([{ role: 'user', content: 'retry' }]);
    });

    // While streaming, error should already be cleared
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.tokens).toBe('');

    // Clean up: stop the held stream
    act(() => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// Suite 14 — truncated stream (connection drop without message_stop)
// ---------------------------------------------------------------------------
describe('useStream — truncated stream', () => {
  it('sets error and clears isStreaming when stream closes without message_stop', async () => {
    server.use(truncatedHandler);
    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.error).toContain('Stream ended without completing');
    // Partial tokens received before truncation are preserved
    expect(result.current.tokens).toBe('one two three four five six seven eight');
  });

  it('sets failedMessages for retry on truncated stream', async () => {
    server.use(truncatedHandler);
    const { result } = renderHook(() => useStream());
    const messages: Parameters<typeof result.current.send>[0] = [{ role: 'user', content: 'Hi' }];

    act(() => {
      void result.current.send(messages);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.failedMessages).toEqual(messages);
  });

  it('does not call onComplete on truncated stream', async () => {
    server.use(truncatedHandler);
    const onComplete = jest.fn();
    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }], null, onComplete);
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('leaves isThinking true when stream truncates mid-thinking block', async () => {
    // Truncation during thinking: thinking_block_start received, but no
    // thinking_block_stop or message_stop before the connection drops.
    // isThinking stays true — consumers must gate on isStreaming.
    server.use(
      createSyncHandler([
        { type: 'message_start', message_id: 'think-truncated' },
        { type: 'content_block_start' },
        { type: 'thinking_block_start' },
        { type: 'thinking_delta', delta: { text: 'Reasoning...' } },
        // Connection drops — no thinking_block_stop, no message_stop
      ])
    );
    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Think' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.error).toContain('Stream ended without completing');
    expect(result.current.isThinking).toBe(true);
    expect(result.current.thinkingText).toBe('Reasoning...');
  });

  it('detects empty stream as truncation (200 OK, immediate close)', async () => {
    server.use(createSyncHandler([]));
    const { result } = renderHook(() => useStream());

    act(() => {
      void result.current.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.error).toContain('Stream ended without completing');
    expect(result.current.tokens).toBe('');
    expect(result.current.ttft).toBeNull();
  });
});
