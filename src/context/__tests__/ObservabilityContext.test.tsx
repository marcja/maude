/**
 * src/context/__tests__/ObservabilityContext.test.tsx
 *
 * Tests for ObservabilityContext: reducer logic (pure function, no React)
 * and provider/hook integration (renderHook).
 *
 * Split into two describe blocks:
 * 1. observabilityReducer — unit tests for the pure reducer
 * 2. ObservabilityProvider + useObservability — integration tests
 *
 * Why crypto.randomUUID mock: the reducer assigns IDs via crypto.randomUUID().
 * Mocking it produces deterministic IDs so assertions are stable.
 */

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  INITIAL_OBSERVABILITY_STATE,
  ObservabilityProvider,
  type ObservabilityState,
  type RequestMetrics,
  observabilityReducer,
  useObservability,
} from '../ObservabilityContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  // jsdom doesn't provide crypto.randomUUID — define it so jest.spyOn can
  // intercept it. The implementation produces deterministic sequential IDs.
  if (!crypto.randomUUID) {
    // Assignment needed: jsdom's crypto object lacks randomUUID; we polyfill
    // it so jest.spyOn has a property to intercept.
    Object.defineProperty(crypto, 'randomUUID', {
      value: () => '',
      writable: true,
      configurable: true,
    });
  }
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    uuidCounter += 1;
    // Cast needed: mock returns a sequential string that doesn't match the
    // UUID v4 branded type, but is sufficient for deterministic test assertions.
    return `test-uuid-${uuidCounter}` as ReturnType<typeof crypto.randomUUID>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Factory for a minimal RequestMetrics object. Accepts overrides for any field. */
function makeRequest(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    status: 'streaming',
    timestamp: Date.now(),
    ttft: null,
    throughput: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite 1: observabilityReducer — pure function tests
// ---------------------------------------------------------------------------

describe('observabilityReducer', () => {
  it('ADD_EVENT prepends an event and assigns an id', () => {
    const state = observabilityReducer(INITIAL_OBSERVABILITY_STATE, {
      type: 'ADD_EVENT',
      event: {
        type: 'message_sent',
        payload: '42 chars',
        timestamp: 1000,
        requestId: null,
      },
    });

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toEqual({
      id: 'test-uuid-1',
      type: 'message_sent',
      payload: '42 chars',
      timestamp: 1000,
      requestId: null,
    });
  });

  it('ADD_EVENT caps events at 200, dropping the oldest', () => {
    let state: ObservabilityState = INITIAL_OBSERVABILITY_STATE;
    for (let i = 0; i < 200; i++) {
      state = observabilityReducer(state, {
        type: 'ADD_EVENT',
        event: {
          type: 'stream_started',
          payload: `event-${i}`,
          timestamp: i,
          requestId: null,
        },
      });
    }
    expect(state.events).toHaveLength(200);

    // Adding one more should drop the oldest
    state = observabilityReducer(state, {
      type: 'ADD_EVENT',
      event: {
        type: 'stream_completed',
        payload: 'newest',
        timestamp: 9999,
        requestId: null,
      },
    });

    expect(state.events).toHaveLength(200);
    expect(state.events[0].payload).toBe('newest');
    // The oldest event (event-0) should have been dropped
    expect(state.events[199].payload).toBe('event-1');
  });

  it('START_REQUEST prepends a request', () => {
    const request = makeRequest({ id: 'req-1' });
    const state = observabilityReducer(INITIAL_OBSERVABILITY_STATE, {
      type: 'START_REQUEST',
      request,
    });

    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toEqual(request);
  });

  it('START_REQUEST caps requests at 10, dropping the oldest', () => {
    let state: ObservabilityState = INITIAL_OBSERVABILITY_STATE;
    for (let i = 0; i < 10; i++) {
      state = observabilityReducer(state, {
        type: 'START_REQUEST',
        request: makeRequest({ id: `req-${i}` }),
      });
    }
    expect(state.requests).toHaveLength(10);

    // Adding one more should drop the oldest
    state = observabilityReducer(state, {
      type: 'START_REQUEST',
      request: makeRequest({ id: 'req-newest' }),
    });

    expect(state.requests).toHaveLength(10);
    expect(state.requests[0].id).toBe('req-newest');
    expect(state.requests[9].id).toBe('req-1');
  });

  it('UPDATE_REQUEST merges partial updates into the matching request', () => {
    const request = makeRequest({ id: 'req-1', status: 'streaming' });
    let state = observabilityReducer(INITIAL_OBSERVABILITY_STATE, {
      type: 'START_REQUEST',
      request,
    });

    state = observabilityReducer(state, {
      type: 'UPDATE_REQUEST',
      id: 'req-1',
      updates: { status: 'completed', ttft: 312, throughput: 47.2 },
    });

    expect(state.requests[0]).toEqual({
      ...request,
      status: 'completed',
      ttft: 312,
      throughput: 47.2,
    });
  });

  it('UPDATE_REQUEST returns the same state object when id is not found', () => {
    const request = makeRequest({ id: 'req-1' });
    const prevState = { ...INITIAL_OBSERVABILITY_STATE, requests: [request] };
    const nextState = observabilityReducer(prevState, {
      type: 'UPDATE_REQUEST',
      id: 'nonexistent',
      updates: { status: 'completed' },
    });

    // Referential identity — true no-op, no new object allocated
    expect(nextState).toBe(prevState);
  });

  it('SET_SYSTEM_PROMPT replaces the prompt value', () => {
    const state = observabilityReducer(INITIAL_OBSERVABILITY_STATE, {
      type: 'SET_SYSTEM_PROMPT',
      prompt: 'You are a helpful assistant.',
    });

    expect(state.systemPrompt).toBe('You are a helpful assistant.');
  });

  it('CLEAR resets to initial state', () => {
    let state: ObservabilityState = INITIAL_OBSERVABILITY_STATE;
    state = observabilityReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'message_sent', payload: 'hi', timestamp: 1, requestId: null },
    });
    state = observabilityReducer(state, {
      type: 'START_REQUEST',
      request: makeRequest(),
    });
    state = observabilityReducer(state, {
      type: 'SET_SYSTEM_PROMPT',
      prompt: 'test',
    });

    // Verify state is non-empty
    expect(state.events.length).toBeGreaterThan(0);
    expect(state.requests.length).toBeGreaterThan(0);
    expect(state.systemPrompt).not.toBeNull();

    // Clear should reset everything
    state = observabilityReducer(state, { type: 'CLEAR' });
    expect(state).toEqual(INITIAL_OBSERVABILITY_STATE);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: ObservabilityProvider + useObservability — integration tests
// ---------------------------------------------------------------------------

/** Wrapper component that provides the context for renderHook. */
function wrapper({ children }: { children: ReactNode }) {
  return <ObservabilityProvider>{children}</ObservabilityProvider>;
}

describe('ObservabilityProvider + useObservability', () => {
  it('throws when useObservability is called outside the provider', () => {
    // Suppress React error boundary console output during the expected throw
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useObservability());
    }).toThrow('useObservability must be used within an ObservabilityProvider');

    spy.mockRestore();
  });

  it('addEvent dispatches and event appears in state.events', () => {
    const { result } = renderHook(() => useObservability(), { wrapper });

    act(() => {
      result.current.addEvent({
        type: 'message_sent',
        payload: '42 chars',
        timestamp: 1000,
        requestId: null,
      });
    });

    expect(result.current.state.events).toHaveLength(1);
    expect(result.current.state.events[0].type).toBe('message_sent');
    expect(result.current.state.events[0].payload).toBe('42 chars');
  });

  it('startRequest + updateRequest lifecycle works end-to-end', () => {
    const { result } = renderHook(() => useObservability(), { wrapper });

    const request = makeRequest({ id: 'req-lifecycle', status: 'streaming' });

    act(() => {
      result.current.startRequest(request);
    });

    expect(result.current.state.requests).toHaveLength(1);
    expect(result.current.state.requests[0].status).toBe('streaming');

    act(() => {
      result.current.updateRequest('req-lifecycle', {
        status: 'completed',
        ttft: 250,
        throughput: 45.3,
        inputTokens: 100,
        outputTokens: 200,
        durationMs: 4420,
      });
    });

    expect(result.current.state.requests[0]).toEqual({
      ...request,
      status: 'completed',
      ttft: 250,
      throughput: 45.3,
      inputTokens: 100,
      outputTokens: 200,
      durationMs: 4420,
    });
  });

  it('setSystemPrompt updates state.systemPrompt', () => {
    const { result } = renderHook(() => useObservability(), { wrapper });

    expect(result.current.state.systemPrompt).toBeNull();

    act(() => {
      result.current.setSystemPrompt('You are a helpful assistant named Alice.');
    });

    expect(result.current.state.systemPrompt).toBe('You are a helpful assistant named Alice.');
  });

  it('clear resets all state', () => {
    const { result } = renderHook(() => useObservability(), { wrapper });

    // Build up state
    act(() => {
      result.current.addEvent({
        type: 'message_sent',
        payload: 'hi',
        timestamp: 1,
        requestId: null,
      });
      result.current.startRequest(makeRequest({ id: 'req-clear' }));
      result.current.setSystemPrompt('test prompt');
    });

    // Verify non-empty
    expect(result.current.state.events.length).toBeGreaterThan(0);
    expect(result.current.state.requests.length).toBeGreaterThan(0);
    expect(result.current.state.systemPrompt).not.toBeNull();

    // Clear
    act(() => {
      result.current.clear();
    });

    expect(result.current.state).toEqual(INITIAL_OBSERVABILITY_STATE);
  });
});
