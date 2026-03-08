/**
 * @jest-environment node
 *
 * Tests run in Node (not jsdom) because they mock globalThis.fetch and use
 * Node-native ReadableStream. No Ollama instance is needed — all HTTP is mocked.
 */

import { ModelAdapterError, streamCompletion } from '../modelAdapter';
import type { ChatMessage } from '../modelAdapter';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Encode SSE lines into a Uint8Array chunk. */
function sseChunk(...lines: string[]): Uint8Array {
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

/**
 * Build a mock Response whose body is a ReadableStream emitting the provided
 * chunks in order. Mimics what fetch returns for a streaming Ollama response.
 */
function mockStreamResponse(chunks: Uint8Array[], status = 200): Response {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

/** Consume an AsyncIterable and return all yielded values. */
async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const tokens: string[] = [];
  for await (const t of iter) tokens.push(t);
  return tokens;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = 'You are a helpful assistant.';
const USER_MESSAGES: ChatMessage[] = [{ role: 'user', content: 'Hello!' }];

// Restore all spies after every test so each test starts with a clean fetch.
// Declared once here rather than inside every it() to avoid the duplication and
// to guarantee cleanup runs even when a test throws before its manual restore.
afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Suite 1: Request shape
// ---------------------------------------------------------------------------

describe('streamCompletion — request shape', () => {
  it('POSTs to /v1/chat/completions with correct headers and body', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockStreamResponse([sseChunk('data: [DONE]')]));
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const iter = await streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal);
    await collect(iter); // consume so fetch is fully used

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/v1\/chat\/completions$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      messages: { role: string; content: string }[];
    };
    expect(body.stream).toBe(true);
    expect(typeof body.model).toBe('string');
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(body.messages[1]).toEqual(USER_MESSAGES[0]);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Token streaming — one chunk per SSE line
// ---------------------------------------------------------------------------

describe('streamCompletion — token streaming', () => {
  it('yields tokens from data lines and stops at [DONE]', async () => {
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const iter = await streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal);
    const tokens = await collect(iter);

    expect(tokens).toEqual(['Hello', ' world']);
  });

  it('ignores delta lines with empty or missing content', async () => {
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"content":""}}]}',
      'data: {"choices":[{"delta":{}}]}',
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const iter = await streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal);
    const tokens = await collect(iter);

    expect(tokens).toEqual(['hi']);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Multi-line chunks split across reads
// ---------------------------------------------------------------------------

describe('streamCompletion — partial/multi-line chunks', () => {
  it('correctly handles two SSE lines arriving in separate chunks', async () => {
    const chunk1 = sseChunk('data: {"choices":[{"delta":{"content":"foo"}}]}');
    const chunk2 = sseChunk('data: {"choices":[{"delta":{"content":"bar"}}]}', 'data: [DONE]');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk1, chunk2]));

    const iter = await streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal);
    const tokens = await collect(iter);

    expect(tokens).toEqual(['foo', 'bar']);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Signal propagation
// ---------------------------------------------------------------------------

describe('streamCompletion — signal propagation', () => {
  it('passes the caller AbortSignal to fetch', async () => {
    const controller = new AbortController();
    const mockFetch = jest.fn().mockResolvedValue(mockStreamResponse([sseChunk('data: [DONE]')]));
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const iter = await streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, controller.signal);
    await collect(iter);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: model_unreachable error
// ---------------------------------------------------------------------------

describe('streamCompletion — model_unreachable', () => {
  it('throws ModelAdapterError with code model_unreachable when fetch rejects', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'model_unreachable' });
  });

  it('error is instance of ModelAdapterError', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network error'));

    let caught: unknown;
    try {
      await streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ModelAdapterError);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: bad_response error
// ---------------------------------------------------------------------------

describe('streamCompletion — bad_response', () => {
  it('throws ModelAdapterError with code bad_response on non-2xx status', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

    await expect(
      streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'bad_response' });
  });
});
