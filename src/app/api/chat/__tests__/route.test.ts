/**
 * @jest-environment node
 *
 * Tests run in Node because the route uses ReadableStream, TextEncoder, and
 * crypto.randomUUID — all available natively in Node 18+. No Ollama instance
 * is needed: streamCompletion and getSettings are mocked at module level.
 *
 * These tests verify the BFF's translation responsibility: Ollama raw tokens IN,
 * Anthropic-style SSE events OUT.
 */

import type { SSEEvent } from '../../../../lib/client/events';
import type { ChatMessage, StreamResult } from '../../../../lib/server/modelAdapter';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any import that resolves the module
// ---------------------------------------------------------------------------

// Mock the DB so tests never touch the filesystem. getSettings returns empty
// settings by default; individual tests override with mockReturnValueOnce.
// createConversation and insertMessage are no-ops by default; verified in Suite 5.
jest.mock('../../../../lib/server/db', () => ({
  getSettings: jest.fn(() => ({ name: '', personalizationPrompt: '' })),
  createConversation: jest.fn(),
  insertMessage: jest.fn(),
  updateConversation: jest.fn(),
}));

// Mock the model adapter so no HTTP request is made to Ollama. streamCompletion
// is replaced per-test with an async generator yielding controlled token sequences.
jest.mock('../../../../lib/server/modelAdapter', () => {
  // Re-export ModelAdapterError as the real class so instanceof checks in the
  // route still work against the mocked module's reference.
  class ModelAdapterError extends Error {
    constructor(
      public readonly code: 'model_unreachable' | 'bad_response',
      message: string
    ) {
      super(message);
      this.name = 'ModelAdapterError';
    }
  }
  return {
    streamCompletion: jest.fn(),
    ModelAdapterError,
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------

import {
  createConversation,
  getSettings,
  insertMessage,
  updateConversation,
} from '../../../../lib/server/db';
import { ModelAdapterError, streamCompletion } from '../../../../lib/server/modelAdapter';
import { POST } from '../route';

const mockGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
const mockStreamCompletion = streamCompletion as jest.MockedFunction<typeof streamCompletion>;
const mockCreateConversation = createConversation as jest.MockedFunction<typeof createConversation>;
const mockInsertMessage = insertMessage as jest.MockedFunction<typeof insertMessage>;
const mockUpdateConversation = updateConversation as jest.MockedFunction<typeof updateConversation>;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Consume a streaming Response body and parse each SSE data line into an
 * SSEEvent. Lines are split on the double-newline SSE event separator.
 * Malformed lines are skipped (mirrors sseParser's graceful handling).
 */
async function collectEvents(response: Response): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const text = await response.text();

  // SSE events are separated by blank lines; each event is "data: <json>\n"
  for (const block of text.split('\n\n')) {
    const line = block.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as SSEEvent;
      events.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return events;
}

/** Build a minimal NextRequest-compatible Request for POST /api/chat. */
function makeRequest(
  messages: ChatMessage[],
  conversationId: string | null = null,
  signal?: AbortSignal
): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, conversationId }),
    signal,
  });
}

/** Build a StreamResult from a list of token strings. Usage defaults to null. */
function tokenGen(tokens: string[]): StreamResult {
  async function* gen(): AsyncIterable<string> {
    for (const t of tokens) yield t;
  }
  return { tokens: gen(), getUsage: () => null };
}

/** Build a raw Request with an arbitrary JSON-serialised body for validation tests. */
function rawRequest(body: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Restore mocks after each test so state doesn't bleed between suites.
afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Suite 1: Happy path event sequence
// ---------------------------------------------------------------------------

describe('POST /api/chat — happy path event sequence', () => {
  it('emits message_start → content_block_start → deltas → content_block_stop → message_stop', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hello', ' world']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    expect(events[0]).toMatchObject({ type: 'message_start' });
    expect(events[1]).toEqual({ type: 'content_block_start' });
    expect(events[2]).toEqual({ type: 'content_block_delta', delta: { text: 'Hello' } });
    expect(events[3]).toEqual({ type: 'content_block_delta', delta: { text: ' world' } });
    expect(events[4]).toEqual({ type: 'content_block_stop' });
    expect(events[5]).toMatchObject({ type: 'message_stop' });
    expect(events).toHaveLength(6);
  });

  it('emits a single delta per token', async () => {
    const tokens = ['a', 'b', 'c'];
    mockStreamCompletion.mockResolvedValue(tokenGen(tokens));

    const response = await POST(makeRequest([{ role: 'user', content: 'test' }]));
    const events = await collectEvents(response);

    const deltas = events.filter((e) => e.type === 'content_block_delta');
    expect(deltas).toHaveLength(3);
    expect(deltas[0]).toEqual({ type: 'content_block_delta', delta: { text: 'a' } });
    expect(deltas[1]).toEqual({ type: 'content_block_delta', delta: { text: 'b' } });
    expect(deltas[2]).toEqual({ type: 'content_block_delta', delta: { text: 'c' } });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: message_start fields
// ---------------------------------------------------------------------------

describe('POST /api/chat — message_start fields', () => {
  it('includes a non-empty message_id in message_start', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen([]));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    const start = events.find((e) => e.type === 'message_start');
    expect(start).toBeDefined();
    // Type narrowing for the discriminated union
    if (start?.type === 'message_start') {
      expect(typeof start.message_id).toBe('string');
      expect(start.message_id.length).toBeGreaterThan(0);
    }
  });

  it('includes prompt_used in message_start and it reflects injected name', async () => {
    // Return settings with a name so buildSystemPrompt injects it
    mockGetSettings.mockReturnValueOnce({ name: 'Alice', personalizationPrompt: '' });
    mockStreamCompletion.mockResolvedValue(tokenGen([]));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hello' }]));
    const events = await collectEvents(response);

    const start = events.find((e) => e.type === 'message_start');
    if (start?.type === 'message_start') {
      expect(start.prompt_used).toContain('Alice');
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Error handling
// ---------------------------------------------------------------------------

describe('POST /api/chat — error events', () => {
  it('emits an error event with the adapter error code on model_unreachable', async () => {
    // streamCompletion rejects before yielding any token
    mockStreamCompletion.mockRejectedValue(
      new ModelAdapterError('model_unreachable', 'Cannot reach Ollama')
    );

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.code).toBe('model_unreachable');
    }
  });

  it('still emits message_start before the error event', async () => {
    mockStreamCompletion.mockRejectedValue(new ModelAdapterError('bad_response', 'HTTP 503'));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('error');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: HTTP response metadata
// ---------------------------------------------------------------------------

describe('POST /api/chat — response headers', () => {
  it('sets Content-Type to text/event-stream', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen([]));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));

    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
  });

  it('returns a 200 status', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen([]));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));

    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: DB persistence
// ---------------------------------------------------------------------------

describe('POST /api/chat — DB persistence', () => {
  it('writes conversation and two messages on completed stream', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hello', ' world']));

    const messages: ChatMessage[] = [{ role: 'user', content: 'Plan your approach' }];
    // Consume the body so the ReadableStream start() runs to completion.
    await collectEvents(await POST(makeRequest(messages)));

    // Conversation created with title from first user message
    expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.any(String),
      'Plan your approach',
      expect.any(Number)
    );

    // Two messages inserted: user then assistant
    expect(mockInsertMessage).toHaveBeenCalledTimes(2);
    expect(mockInsertMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'user', content: 'Plan your approach' })
    );
    expect(mockInsertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: 'assistant', content: 'Hello world' })
    );
  });

  it('writes no DB row when the stream is aborted', async () => {
    // Simulate Ollama fetch throwing when the abort signal fires
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockStreamCompletion.mockRejectedValue(abortError);

    const controller = new AbortController();
    controller.abort();
    const request = makeRequest([{ role: 'user', content: 'Hi' }], null, controller.signal);

    await collectEvents(await POST(request));

    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockInsertMessage).not.toHaveBeenCalled();
  });

  it('skips createConversation but inserts messages and updates timestamp when conversationId is provided', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hi']));

    const messages: ChatMessage[] = [{ role: 'user', content: 'Continue' }];
    await collectEvents(await POST(makeRequest(messages, 'existing-id')));

    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockUpdateConversation).toHaveBeenCalledWith('existing-id', {
      updated_at: expect.any(Number),
    });
    expect(mockInsertMessage).toHaveBeenCalledTimes(2);
    expect(mockInsertMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'user', conversation_id: 'existing-id' })
    );
    expect(mockInsertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: 'assistant', conversation_id: 'existing-id' })
    );
  });

  it('uses "New conversation" as title when no user message is present', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['reply']));

    // Send only an assistant message — no user message in the array.
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'Welcome' }];
    await collectEvents(await POST(makeRequest(messages)));

    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.any(String),
      'New conversation',
      expect.any(Number)
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Request body validation
// ---------------------------------------------------------------------------

describe('POST /api/chat — request body validation', () => {
  it('returns 400 when messages field is missing', async () => {
    const response = await POST(rawRequest({ conversationId: null }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/messages/i);
  });

  it('returns 400 when messages is not an array', async () => {
    const response = await POST(rawRequest({ messages: 'not-an-array' }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/messages/i);
  });

  it('returns 400 when messages is an empty array', async () => {
    const response = await POST(rawRequest({ messages: [] }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/messages/i);
  });

  it('returns 400 when a message has an invalid role', async () => {
    const response = await POST(rawRequest({ messages: [{ role: 'system', content: 'hi' }] }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/role/i);
  });

  it('returns 400 when a message has non-string content', async () => {
    const response = await POST(rawRequest({ messages: [{ role: 'user', content: 123 }] }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/content/i);
  });

  it('returns 400 when conversationId is a non-string truthy value', async () => {
    const response = await POST(
      rawRequest({ messages: [{ role: 'user', content: 'hi' }], conversationId: 42 })
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/conversationId/i);
  });

  it('accepts valid body with conversationId: null', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['ok']));
    const response = await POST(
      rawRequest({ messages: [{ role: 'user', content: 'hi' }], conversationId: null })
    );
    expect(response.status).toBe(200);
  });

  it('accepts valid body without conversationId field', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['ok']));
    const response = await POST(rawRequest({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Non-ModelAdapterError maps to unknown error code
// ---------------------------------------------------------------------------

describe('POST /api/chat — generic error code', () => {
  it('emits error event with code "unknown" for non-ModelAdapterError throws', async () => {
    // A plain Error (not a ModelAdapterError) should produce code: 'unknown'.
    mockStreamCompletion.mockRejectedValue(new Error('Something unexpected'));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.code).toBe('unknown');
      expect(errorEvent.error.message).toBe('Something unexpected');
    }
  });

  it('uses String(err) as the error message when a non-Error is thrown', async () => {
    // Defensive path: if something throws a non-Error (e.g., a string), the
    // route must not crash — it calls String() to produce a message.
    mockStreamCompletion.mockRejectedValue('raw string error');

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'error') {
      expect(errorEvent.error.message).toBe('raw string error');
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 8: Thinking block detection
// ---------------------------------------------------------------------------

/** Collect all thinking_delta text from an event sequence. */
function collectThinkingText(events: SSEEvent[]): string {
  return events
    .filter((e): e is Extract<SSEEvent, { type: 'thinking_delta' }> => e.type === 'thinking_delta')
    .map((e) => e.delta.text)
    .join('');
}

/** Collect all content_block_delta text from an event sequence. */
function collectContentText(events: SSEEvent[]): string {
  return events
    .filter(
      (e): e is Extract<SSEEvent, { type: 'content_block_delta' }> =>
        e.type === 'content_block_delta'
    )
    .map((e) => e.delta.text)
    .join('');
}

describe('POST /api/chat — thinking block detection', () => {
  it('emits no thinking events when tokens contain no <think> tags', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hello', ' world']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    expect(events.some((e) => e.type === 'thinking_block_start')).toBe(false);
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(false);
    expect(events.some((e) => e.type === 'thinking_block_stop')).toBe(false);
    expect(collectContentText(events)).toBe('Hello world');
  });

  it('emits thinking_block_start → thinking_delta → thinking_block_stop for a complete <think> block', async () => {
    // Complete open and close tags in a single token to verify the basic happy path.
    mockStreamCompletion.mockResolvedValue(tokenGen(['<think>reason</think>answer']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    const types = events.map((e) => e.type);
    expect(types).toContain('thinking_block_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_block_stop');
    expect(collectThinkingText(events)).toBe('reason');
    expect(collectContentText(events)).toBe('answer');
  });

  it('handles <think> split across token boundary', async () => {
    // '<thi' must be held back until 'nk>...' arrives to complete the open tag.
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hello <thi', 'nk>reason</think>answer']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    expect(collectContentText(events)).toBe('Hello answer');
    expect(collectThinkingText(events)).toBe('reason');
  });

  it('handles </think> split across token boundary', async () => {
    // '</th' must be held back until 'ink>...' arrives to complete the close tag.
    mockStreamCompletion.mockResolvedValue(tokenGen(['<think>reason</th', 'ink>answer']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    expect(collectThinkingText(events)).toBe('reason');
    expect(collectContentText(events)).toBe('answer');
  });

  it('emits thinking events before content events when stream starts with <think>', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['<think>reason</think>answer']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    const thinkStart = events.findIndex((e) => e.type === 'thinking_block_start');
    const contentStart = events.findIndex((e) => e.type === 'content_block_start');
    // thinking block must open before content block
    expect(thinkStart).toBeLessThan(contentStart);
  });

  it('persists thinking content separately from visible content in DB', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['<think>inner</think>outer']));

    await collectEvents(await POST(makeRequest([{ role: 'user', content: 'Hi' }])));

    expect(mockInsertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: 'assistant', content: 'outer', thinking: 'inner' })
    );
  });

  it('accumulates multiple thinking tokens correctly', async () => {
    mockStreamCompletion.mockResolvedValue(
      tokenGen(['<think>', 'step one ', 'step two', '</think>', 'done'])
    );

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    expect(collectThinkingText(events)).toBe('step one step two');
    expect(collectContentText(events)).toBe('done');
  });

  it('flushes leftover buffer as thinking delta when stream ends mid-think', async () => {
    // Model stops generating while still inside a <think> block — the leftover
    // buffer text must be flushed as a thinking delta (not a content delta).
    mockStreamCompletion.mockResolvedValue(tokenGen(['<think>partial thought']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    expect(collectThinkingText(events)).toBe('partial thought');
    // No content should have been emitted
    expect(collectContentText(events)).toBe('');
    // Thinking block should still be closed at end of stream
    expect(events.some((e) => e.type === 'thinking_block_stop')).toBe(true);
  });

  it('flushes partial open-tag buffer as content delta at end-of-stream', async () => {
    // Stream ends while holding back a partial <think> match (e.g. "<th").
    // The held-back text must be flushed as a content delta, not swallowed.
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hello <th']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    expect(collectContentText(events)).toBe('Hello <th');
    expect(collectThinkingText(events)).toBe('');
  });

  it('flushes partial close-tag buffer as thinking delta at end-of-stream', async () => {
    // Stream ends while holding back a partial </think> match (e.g. "</th").
    // The held-back text must be flushed as a thinking delta, not swallowed.
    mockStreamCompletion.mockResolvedValue(tokenGen(['<think>reason</th']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hi' }]));
    const events = await collectEvents(response);

    // "reason" arrives as thinking delta during parsing; "</th" is held back
    // as a potential partial tag, then flushed as thinking delta at end-of-stream.
    expect(collectThinkingText(events)).toBe('reason</th');
    expect(collectContentText(events)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Suite 9: Additional validation edge cases
// ---------------------------------------------------------------------------

describe('POST /api/chat — validation edge cases', () => {
  it('returns 400 when body is a non-object (string)', async () => {
    const response = await POST(rawRequest('just a string'));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/object/i);
  });

  it('returns 400 when body is null', async () => {
    const response = await POST(rawRequest(null));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/object/i);
  });

  it('returns 400 when a message element is not an object', async () => {
    const response = await POST(rawRequest({ messages: ['not-an-object'] }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/message/i);
  });

  it('rethrows non-ValidationError from request.json()', async () => {
    // When request.json() throws a non-ValidationError (e.g. invalid JSON),
    // the catch block should rethrow rather than returning a 400.
    const request = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{{',
    });

    await expect(POST(request)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite 10: Multi-turn conversation persistence (B5)
// ---------------------------------------------------------------------------

describe('POST /api/chat — multi-turn conversation persistence', () => {
  it('includes conversation_id in message_stop event', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hi']));

    const response = await POST(makeRequest([{ role: 'user', content: 'Hello' }]));
    const events = await collectEvents(response);

    const stopEvent = events.find((e) => e.type === 'message_stop');
    expect(stopEvent).toBeDefined();
    if (stopEvent?.type === 'message_stop') {
      expect(typeof stopEvent.conversation_id).toBe('string');
      expect(stopEvent.conversation_id.length).toBeGreaterThan(0);
    }
  });

  it('returns the provided conversationId in message_stop when continuing a conversation', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['reply']));

    const response = await POST(
      makeRequest([{ role: 'user', content: 'Continue' }], 'existing-conv-42')
    );
    const events = await collectEvents(response);

    const stopEvent = events.find((e) => e.type === 'message_stop');
    if (stopEvent?.type === 'message_stop') {
      expect(stopEvent.conversation_id).toBe('existing-conv-42');
    }
  });

  it('saves the LAST user message content for multi-turn conversations', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['answer']));

    const messages: ChatMessage[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up question' },
    ];
    await collectEvents(await POST(makeRequest(messages)));

    // The user message persisted should be the LAST one, not the first
    expect(mockInsertMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'user', content: 'Follow-up question' })
    );
  });

  it('does not call updateConversation for new conversations', async () => {
    mockStreamCompletion.mockResolvedValue(tokenGen(['Hi']));

    await collectEvents(await POST(makeRequest([{ role: 'user', content: 'Hello' }])));

    expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockUpdateConversation).not.toHaveBeenCalled();
  });
});
