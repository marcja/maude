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
import { midstreamErrorHandler } from '../../mocks/handlers/midstream-error';
import { normalHandler } from '../../mocks/handlers/normal';
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
    // This handler holds the stream open, then errors it when the request
    // signal fires. Without wiring request.signal → controller.error(), the
    // blocked reader.read() inside parseSSEStream would never unblock and the
    // AbortError catch path in useStream would never be reached.
    const holdHandler = http.post('/api/chat', ({ request }) => {
      const stream = new ReadableStream({
        start(controller) {
          request.signal.addEventListener(
            'abort',
            () => controller.error(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true }
          );
        },
      });
      return new HttpResponse(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

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
// Suite 5: initial state
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
