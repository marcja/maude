/**
 * @jest-environment ./jest-environment-with-fetch.js
 *
 * Custom environment required because MSW 2.x references WinterCG fetch
 * globals (Response, Request) at module-load time, which jest-environment-jsdom
 * doesn't provide. The custom env injects Node 18+ fetch globals before any
 * module is loaded while preserving jsdom for React Testing Library.
 */

/**
 * src/hooks/__tests__/useObservabilityEvents.test.ts
 *
 * Tests for useObservabilityEvents — the composition hook that bridges
 * useStream lifecycle events to ObservabilityContext.
 *
 * Each test renders useObservabilityEvents inside an ObservabilityProvider.
 * A companion hook reads useObservability().state to assert against the
 * event log and request metrics that the hook emits.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { ObservabilityProvider, useObservability } from '../../context/ObservabilityContext';
import { holdHandler } from '../../mocks/handlers/hold';
import { midstreamErrorHandler } from '../../mocks/handlers/midstream-error';
import { normalHandler } from '../../mocks/handlers/normal';
import { thinkingHandler } from '../../mocks/handlers/thinking';
import { zeroUsageHandler } from '../../mocks/handlers/zero-usage';
import { useObservabilityEvents } from '../useObservabilityEvents';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// crypto.randomUUID mock — deterministic IDs for assertions
// ---------------------------------------------------------------------------

let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  if (!crypto.randomUUID) {
    Object.defineProperty(crypto, 'randomUUID', {
      value: () => '',
      writable: true,
      configurable: true,
    });
  }
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    uuidCounter += 1;
    // Cast: mock returns a sequential string for deterministic assertions.
    return `test-uuid-${uuidCounter}` as ReturnType<typeof crypto.randomUUID>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrapper that provides ObservabilityContext for renderHook.
 * Both useObservabilityEvents and the companion useObservability read
 * from the same provider instance.
 */
function wrapper({ children }: { children: ReactNode }) {
  return <ObservabilityProvider>{children}</ObservabilityProvider>;
}

/**
 * Renders both useObservabilityEvents and useObservability in the same
 * provider so tests can call send/stop AND inspect observability state.
 */
function renderWithObservability() {
  return renderHook(
    () => ({
      stream: useObservabilityEvents(),
      obs: useObservability(),
    }),
    { wrapper }
  );
}

// ---------------------------------------------------------------------------
// Suite 1: initial state — no events before send()
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — initial state', () => {
  it('emits no observability events before send() is called', () => {
    const { result } = renderWithObservability();

    expect(result.current.obs.state.events).toHaveLength(0);
    expect(result.current.obs.state.requests).toHaveLength(0);
    expect(result.current.obs.state.systemPrompt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: message_sent event on send()
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — message_sent', () => {
  it('emits a message_sent event with char count payload when send() is called', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hello' }]);
    });

    // message_sent is emitted synchronously on send(), before any SSE events
    await waitFor(() => {
      const events = result.current.obs.state.events;
      const messageSent = events.find((e) => e.type === 'message_sent');
      expect(messageSent).toBeDefined();
      expect(messageSent?.payload).toBe('5 chars');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: startRequest on send()
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — startRequest', () => {
  it('creates a RequestMetrics entry with status streaming on send()', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => {
      expect(result.current.obs.state.requests).toHaveLength(1);
      expect(result.current.obs.state.requests[0].status).toBe('streaming');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 4: stream_started on first token (TTFT)
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — stream_started (TTFT)', () => {
  it('emits stream_started with TTFT payload on first content_block_delta', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => {
      const streamStarted = result.current.obs.state.events.find(
        (e) => e.type === 'stream_started'
      );
      expect(streamStarted).toBeDefined();
      // Payload format: "{n}ms TTFT" where n is a non-negative integer
      expect(streamStarted?.payload).toMatch(/^\d+ms TTFT$/);
    });

    // Request metrics should have ttft set
    await waitFor(() => {
      expect(result.current.obs.state.requests[0].ttft).not.toBeNull();
      expect(typeof result.current.obs.state.requests[0].ttft).toBe('number');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 5: stream_completed on message_stop
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — stream_completed', () => {
  it('emits stream_completed with token count and duration on message_stop', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    const streamCompleted = result.current.obs.state.events.find(
      (e) => e.type === 'stream_completed'
    );
    expect(streamCompleted).toBeDefined();
    // Payload format: "{n} tok, {s}s" — e.g. "2 tok, 0.1s"
    expect(streamCompleted?.payload).toMatch(/^\d+ tok, \d+\.\ds$/);

    // Request metrics should be updated to completed
    const req = result.current.obs.state.requests[0];
    expect(req.status).toBe('completed');
    expect(req.inputTokens).toBe(3);
    expect(req.outputTokens).toBe(2);
    expect(req.durationMs).not.toBeNull();
    expect(req.throughput).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: stream_cancelled on abort
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — stream_cancelled', () => {
  it('emits stream_cancelled with token count on stop()', async () => {
    server.use(holdHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(true));

    act(() => {
      result.current.stream.stop();
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    const streamCancelled = result.current.obs.state.events.find(
      (e) => e.type === 'stream_cancelled'
    );
    expect(streamCancelled).toBeDefined();
    // holdHandler emits 0 tokens, so payload should be "0 tok rcvd"
    expect(streamCancelled?.payload).toBe('0 tok rcvd');

    // Request metrics should reflect cancellation
    expect(result.current.obs.state.requests[0].status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// Suite 7: stream_error on error event
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — stream_error', () => {
  it('emits stream_error with truncated message on SSE error event', async () => {
    server.use(midstreamErrorHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hi' }]);
    });

    await waitFor(() => expect(result.current.stream.error).not.toBeNull());

    const streamError = result.current.obs.state.events.find((e) => e.type === 'stream_error');
    expect(streamError).toBeDefined();
    expect(streamError?.payload).toBe('Stream failed');

    // Request metrics should reflect error status
    expect(result.current.obs.state.requests[0].status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Suite 8: thinking events
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — thinking events', () => {
  it('emits thinking_started and thinking_completed with duration', async () => {
    server.use(thinkingHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Think' }]);
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    const events = result.current.obs.state.events;
    const thinkingStarted = events.find((e) => e.type === 'thinking_started');
    const thinkingCompleted = events.find((e) => e.type === 'thinking_completed');

    expect(thinkingStarted).toBeDefined();
    expect(thinkingStarted?.payload).toBe('');

    expect(thinkingCompleted).toBeDefined();
    // Payload format: "{n}ms" — duration of thinking block
    expect(thinkingCompleted?.payload).toMatch(/^\d+ms$/);
  });
});

// ---------------------------------------------------------------------------
// Suite 9: setSystemPrompt from message_start.prompt_used
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — setSystemPrompt', () => {
  it('sets systemPrompt when message_start includes prompt_used', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    // normalHandler includes prompt_used: 'You are a helpful assistant.'
    expect(result.current.obs.state.systemPrompt).toBe('You are a helpful assistant.');
  });
});

// ---------------------------------------------------------------------------
// Suite 10: events link to request via requestId
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — requestId linking', () => {
  it('all stream events reference the same requestId', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    const requestId = result.current.obs.state.requests[0].id;
    const events = result.current.obs.state.events;

    // All events should reference the same request
    for (const event of events) {
      expect(event.requestId).toBe(requestId);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 11: no duplicate stream_cancelled after natural completion
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — no duplicate finalization', () => {
  it('does not emit stream_cancelled if stream already completed naturally', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    // Call stop() after stream has already completed
    act(() => {
      result.current.stream.stop();
    });

    const events = result.current.obs.state.events;
    const cancelledEvents = events.filter((e) => e.type === 'stream_cancelled');
    expect(cancelledEvents).toHaveLength(0);

    // stream_completed should exist exactly once
    const completedEvents = events.filter((e) => e.type === 'stream_completed');
    expect(completedEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 12: multi-send ref reset
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — multi-send reset', () => {
  it('resets TTFT and token count independently for a second request', async () => {
    server.use(normalHandler);
    const { result } = renderWithObservability();

    // First request
    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'First' }]);
    });
    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    // Second request — refs must reset so metrics are independent
    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Second' }]);
    });
    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    const requests = result.current.obs.state.requests;
    expect(requests).toHaveLength(2);
    // TTFT should be set independently (firstTokenRef was reset)
    expect(requests[1].ttft).not.toBeNull();
    // Output tokens should reflect only the second stream, not cumulative
    expect(requests[1].outputTokens).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 13: zero-usage fallback to client-side delta count
// ---------------------------------------------------------------------------

describe('useObservabilityEvents — zero-usage fallback', () => {
  it('falls back to client-side delta count when server returns zero output tokens', async () => {
    server.use(zeroUsageHandler);
    const { result } = renderWithObservability();

    act(() => {
      void result.current.stream.send([{ role: 'user', content: 'Hello' }]);
    });

    await waitFor(() => expect(result.current.stream.isStreaming).toBe(false));

    const req = result.current.obs.state.requests[0];
    expect(req.status).toBe('completed');
    // zeroUsageHandler emits 3 content_block_delta events; server returns 0.
    // Client-side fallback should use the delta count (3).
    expect(req.outputTokens).toBe(3);
    // Input tokens: server returned 0, no client fallback → null (renders "—").
    expect(req.inputTokens).toBeNull();
    // Throughput should be positive since outputTokens > 0.
    expect(req.throughput).toBeGreaterThan(0);
  });
});
