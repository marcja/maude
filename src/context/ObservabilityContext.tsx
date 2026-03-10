'use client';

/**
 * src/context/ObservabilityContext.tsx
 *
 * In-memory event bus for the observability/debug pane. Any component can emit
 * events and metrics via the context without coupling to the pane UI.
 *
 * Design decisions:
 * - Single context with useReducer rather than split contexts or external store.
 *   Only one consumer (the debug pane) needs all three slices, so split contexts
 *   save nothing. External store (useSyncExternalStore) would introduce a pattern
 *   not used elsewhere in this codebase.
 * - Reducer is exported separately so it can be unit-tested as a pure function
 *   without rendering React components.
 * - ObservabilityEvent.type is string (not a union) because the context doesn't
 *   enforce the event vocabulary — it just stores events. T19 emits specific types.
 * - ObservabilityEvent.payload is a pre-formatted string so the Events tab can
 *   display it directly without formatting logic at render time.
 */

import { type ReactNode, createContext, useContext, useReducer } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of a completed or in-progress request. */
export type RequestStatus = 'streaming' | 'completed' | 'cancelled' | 'error' | 'stalled';

/** One entry in the flat event log. */
export interface ObservabilityEvent {
  /** Unique identifier assigned by the reducer via crypto.randomUUID(). */
  id: string;
  /** Event name, e.g. 'message_sent', 'stream_started'. Not a union — the
   *  context stores any string; the event vocabulary is defined by emitters. */
  type: string;
  /** Human-readable summary, e.g. '42 chars', '312ms TTFT'. Pre-formatted so
   *  the Events tab can display it directly. */
  payload: string;
  /** Date.now() when the event occurred. */
  timestamp: number;
  /** Links to RequestMetrics.id; null for standalone events like response_copied. */
  requestId: string | null;
}

/** Per-request metrics snapshot — one per stream. Created at message_sent,
 *  progressively updated as TTFT/throughput/status arrive. */
export interface RequestMetrics {
  /** Unique identifier assigned at creation via crypto.randomUUID(). */
  id: string;
  status: RequestStatus;
  /** Date.now() when the request started. */
  timestamp: number;
  /** Time-to-first-token in milliseconds; null until first content delta. */
  ttft: number | null;
  /** Tokens per second; null until stream completes. */
  throughput: number | null;
  /** Input token count from message_stop usage; null until stream completes. */
  inputTokens: number | null;
  /** Output token count from message_stop usage; null until stream completes. */
  outputTokens: number | null;
  /** Total stream duration in ms; null until stream completes. */
  durationMs: number | null;
}

/** Full observability state managed by the reducer. */
export interface ObservabilityState {
  /** Flat event log, newest-first, capped at MAX_EVENTS. */
  events: ObservabilityEvent[];
  /** Per-request metrics, newest-first, capped at MAX_REQUESTS. */
  requests: RequestMetrics[];
  /** Exact system prompt from the most recent message_start.prompt_used. */
  systemPrompt: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_EVENTS = 200;
const MAX_REQUESTS = 10;

export const INITIAL_OBSERVABILITY_STATE: ObservabilityState = {
  events: [],
  requests: [],
  systemPrompt: null,
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export type ObservabilityAction =
  | { type: 'ADD_EVENT'; event: Omit<ObservabilityEvent, 'id'> }
  | { type: 'START_REQUEST'; request: RequestMetrics }
  | { type: 'UPDATE_REQUEST'; id: string; updates: Partial<Omit<RequestMetrics, 'id'>> }
  | { type: 'SET_SYSTEM_PROMPT'; prompt: string }
  | { type: 'CLEAR' };

/** Pure reducer — exported for direct unit testing without React. */
export function observabilityReducer(
  state: ObservabilityState,
  action: ObservabilityAction
): ObservabilityState {
  switch (action.type) {
    case 'ADD_EVENT': {
      const newEvent: ObservabilityEvent = {
        ...action.event,
        id: crypto.randomUUID(),
      };
      const events = [newEvent, ...state.events].slice(0, MAX_EVENTS);
      return { ...state, events };
    }

    case 'START_REQUEST': {
      const requests = [action.request, ...state.requests].slice(0, MAX_REQUESTS);
      return { ...state, requests };
    }

    case 'UPDATE_REQUEST': {
      const idx = state.requests.findIndex((r) => r.id === action.id);
      if (idx === -1) return state;
      const updated = { ...state.requests[idx], ...action.updates };
      const requests = [...state.requests];
      requests[idx] = updated;
      return { ...state, requests };
    }

    case 'SET_SYSTEM_PROMPT':
      return { ...state, systemPrompt: action.prompt };

    case 'CLEAR':
      return INITIAL_OBSERVABILITY_STATE;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Value exposed to consumers via useObservability(). */
export interface ObservabilityContextValue {
  state: ObservabilityState;
  addEvent: (event: Omit<ObservabilityEvent, 'id'>) => void;
  startRequest: (request: RequestMetrics) => void;
  updateRequest: (id: string, updates: Partial<Omit<RequestMetrics, 'id'>>) => void;
  setSystemPrompt: (prompt: string) => void;
  clear: () => void;
}

const ObservabilityContext = createContext<ObservabilityContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ObservabilityProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(observabilityReducer, INITIAL_OBSERVABILITY_STATE);

  const addEvent = (event: Omit<ObservabilityEvent, 'id'>) => {
    dispatch({ type: 'ADD_EVENT', event });
  };

  const startRequest = (request: RequestMetrics) => {
    dispatch({ type: 'START_REQUEST', request });
  };

  const updateRequest = (id: string, updates: Partial<Omit<RequestMetrics, 'id'>>) => {
    dispatch({ type: 'UPDATE_REQUEST', id, updates });
  };

  const setSystemPrompt = (prompt: string) => {
    dispatch({ type: 'SET_SYSTEM_PROMPT', prompt });
  };

  const clear = () => {
    dispatch({ type: 'CLEAR' });
  };
  const value: ObservabilityContextValue = {
    state,
    addEvent,
    startRequest,
    updateRequest,
    setSystemPrompt,
    clear,
  };

  return <ObservabilityContext value={value}>{children}</ObservabilityContext>;
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/** Access the observability context. Throws if called outside ObservabilityProvider. */
export function useObservability(): ObservabilityContextValue {
  const ctx = useContext(ObservabilityContext);
  if (ctx === null) {
    throw new Error('useObservability must be used within an ObservabilityProvider');
  }
  return ctx;
}
