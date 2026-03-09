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
import { holdHandler } from '../../mocks/handlers/hold';
import { midstreamErrorHandler } from '../../mocks/handlers/midstream-error';
import { normalHandler } from '../../mocks/handlers/normal';
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
// Suite 8: initial state
// ---------------------------------------------------------------------------

describe('useStream — initial state', () => {
  it('starts with empty/null state before send() is called', () => {
    const { result } = renderHook(() => useStream());

    expect(result.current.tokens).toBe('');
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.ttft).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
