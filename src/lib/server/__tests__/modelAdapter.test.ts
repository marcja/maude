/**
 * @jest-environment node
 *
 * Tests run in Node (not jsdom) because they mock globalThis.fetch and use
 * Node-native ReadableStream. No Ollama instance is needed — all HTTP is mocked.
 */

import { ModelAdapterError, streamCompletion } from '../modelAdapter';
import type { ChatMessage, StreamResult } from '../modelAdapter';

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

/** Consume a StreamResult's tokens and return all yielded values. */
async function collect(result: StreamResult): Promise<string[]> {
  const tokens: string[] = [];
  for await (const t of result.tokens) tokens.push(t);
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
  it('when called, POSTs to /v1/chat/completions with correct headers and body shape', async () => {
    const mockFetch = jest.fn().mockResolvedValue(mockStreamResponse([sseChunk('data: [DONE]')]));
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collect(result); // consume so fetch is fully used

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/v1\/chat\/completions$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      stream_options: { include_usage: boolean };
      think: string | boolean;
      messages: { role: string; content: string }[];
    };
    expect(body.stream).toBe(true);
    // Requests usage data in the final streaming chunk.
    expect(body.stream_options).toEqual({ include_usage: true });
    // Default THINK_LEVEL is "medium" (matches default model gpt-oss:20b).
    // gpt-oss ignores boolean true/false and requires a level string.
    expect(body.think).toBe('medium');
    expect(typeof body.model).toBe('string');
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(body.messages[1]).toEqual(USER_MESSAGES[0]);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Token streaming — one chunk per SSE line
// ---------------------------------------------------------------------------

describe('streamCompletion — token streaming', () => {
  it('when data lines contain content deltas, yields each token and stops at [DONE]', async () => {
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['Hello', ' world']);
  });

  it('when delta lines have empty or missing content, skips them and yields only non-empty tokens', async () => {
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"content":""}}]}',
      'data: {"choices":[{"delta":{}}]}',
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['hi']);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Multi-line chunks split across reads
// ---------------------------------------------------------------------------

describe('streamCompletion — partial/multi-line chunks', () => {
  it('when two SSE lines arrive in separate chunks, yields both tokens correctly', async () => {
    const chunk1 = sseChunk('data: {"choices":[{"delta":{"content":"foo"}}]}');
    const chunk2 = sseChunk('data: {"choices":[{"delta":{"content":"bar"}}]}', 'data: [DONE]');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk1, chunk2]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['foo', 'bar']);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Signal propagation
// ---------------------------------------------------------------------------

describe('streamCompletion — signal propagation', () => {
  it('when an AbortSignal is provided, passes it to the underlying fetch call', async () => {
    const controller = new AbortController();
    const mockFetch = jest.fn().mockResolvedValue(mockStreamResponse([sseChunk('data: [DONE]')]));
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, controller.signal);
    await collect(result);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: model_unreachable error
// ---------------------------------------------------------------------------

describe('streamCompletion — model_unreachable', () => {
  it('when fetch rejects with a network error, throws ModelAdapterError with code model_unreachable', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'model_unreachable' });
  });

  it('when fetch rejects, the thrown error is an instance of ModelAdapterError', async () => {
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
  it('when the server returns a non-2xx status, throws ModelAdapterError with code bad_response', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

    await expect(
      streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('when the response body is null, throws ModelAdapterError with code bad_response', async () => {
    // Simulate a 200 response whose body has been consumed/nulled. In the browser
    // a Response.body can be null after .body has been read; guard exists in
    // streamCompletion before passing the body to tokenStream.
    const nullBodyResponse = new Response(null, { status: 200 });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(nullBodyResponse);

    await expect(
      streamCompletion(USER_MESSAGES, SYSTEM_PROMPT, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'bad_response', message: expect.stringContaining('no body') });
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Malformed JSON lines inside the token stream
// ---------------------------------------------------------------------------

describe('streamCompletion — malformed JSON in token stream', () => {
  it('when a malformed JSON line appears mid-stream, skips it and continues yielding tokens', async () => {
    // One bad line sandwiched between two valid ones; the bad line must be
    // silently skipped so the surrounding tokens still arrive.
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"content":"before"}}]}',
      'data: {not valid json',
      'data: {"choices":[{"delta":{"content":"after"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['before', 'after']);
  });
});

// ---------------------------------------------------------------------------
// Suite 8: reasoning field → <think> tag wrapping
// ---------------------------------------------------------------------------

describe('streamCompletion — reasoning support', () => {
  it('when delta.reasoning is present, wraps the reasoning text in <think> tags', async () => {
    // Ollama's /v1/chat/completions endpoint delivers thinking via
    // delta.reasoning. The adapter wraps it in <think> tags so the BFF's
    // existing tag parser handles it transparently.
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"reasoning":"I think..."}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['<think>', 'I think...', '</think>']);
  });

  it('when delta.reasoning_content is present (OpenAI convention), wraps it in <think> tags', async () => {
    // Fallback for backends that use OpenAI's field name instead of Ollama's.
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"fallback"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['<think>', 'fallback', '</think>']);
  });

  it('when reasoning transitions to content, closes the <think> tag before emitting content', async () => {
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"reasoning":"reasoning"}}]}',
      'data: {"choices":[{"delta":{"content":"visible"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['<think>', 'reasoning', '</think>', 'visible']);
  });

  it('when content already contains inline <think> tags, passes them through without double-wrapping', async () => {
    // Models that inline tags directly in content should not be double-wrapped.
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"content":"<think>hello</think>world"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['<think>hello</think>world']);
  });

  it('when both reasoning and content appear in a single delta, emits reasoning first then content', async () => {
    // Edge case: a single SSE line carries both fields. Reasoning is emitted
    // first (wrapped), then content follows.
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"reasoning":"R","content":"C"}}]}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['<think>', 'R', '</think>', 'C']);
  });

  it('when the stream ends mid-reasoning at [DONE], closes the <think> tag', async () => {
    // Model sends reasoning but no content before [DONE] — the adapter must
    // close the <think> wrapper so the BFF sees a balanced tag pair.
    const chunk1 = sseChunk('data: {"choices":[{"delta":{"reasoning":"partial"}}]}');
    const chunk2 = sseChunk('data: [DONE]');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk1, chunk2]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['<think>', 'partial', '</think>']);
  });

  it('when the stream closes without [DONE] while in a reasoning block, closes the <think> tag', async () => {
    // Guard against streams that close without a [DONE] sentinel while still
    // inside a reasoning block.
    const chunk = sseChunk('data: {"choices":[{"delta":{"reasoning":"abrupt"}}]}');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    const tokens = await collect(result);

    expect(tokens).toEqual(['<think>', 'abrupt', '</think>']);
  });
});

// ---------------------------------------------------------------------------
// Suite 9: Usage reporting from final streaming chunk
// ---------------------------------------------------------------------------

describe('streamCompletion — usage reporting', () => {
  it('when the final chunk includes usage data, captures prompt and completion token counts', async () => {
    // Ollama sends a final chunk with usage data when stream_options.include_usage is true.
    const chunk = sseChunk(
      'data: {"choices":[{"delta":{"content":"hi"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collect(result);

    expect(result.getUsage()).toEqual({ promptTokens: 10, completionTokens: 20 });
  });

  it('when no usage chunk is present in the stream, returns null from getUsage()', async () => {
    const chunk = sseChunk('data: {"choices":[{"delta":{"content":"hi"}}]}', 'data: [DONE]');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    await collect(result);

    expect(result.getUsage()).toBeNull();
  });

  it('when tokens have not yet been consumed, returns null from getUsage()', async () => {
    const chunk = sseChunk(
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}',
      'data: [DONE]'
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(mockStreamResponse([chunk]));

    const result = await streamCompletion(
      USER_MESSAGES,
      SYSTEM_PROMPT,
      new AbortController().signal
    );
    // Usage not yet available before consuming
    expect(result.getUsage()).toBeNull();

    await collect(result);
    expect(result.getUsage()).toEqual({ promptTokens: 5, completionTokens: 10 });
  });
});
