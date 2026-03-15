/**
 * @jest-environment node
 *
 * Run in Node (not jsdom) because the tests use Node-native ReadableStream
 * and TextEncoder. No network access — the stream is built in memory.
 */

/**
 * Tests for src/lib/client/sseParser.ts
 *
 * All tests are pure in-memory: no network, no MSW, no Ollama.
 * The helpers mirror the pattern from modelAdapter.test.ts.
 */

import type { SSEEvent } from '../events';
import { parseSSEStream } from '../sseParser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

/** Encode one or more SSE lines (joined with \n) into a Uint8Array chunk. */
function sseChunk(...lines: string[]): Uint8Array {
  return enc.encode(`${lines.join('\n')}\n`);
}

/** Build a ReadableStream that emits the given chunks in sequence. */
function makeStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

/** Drain the async generator into an array. */
async function collect(body: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(body)) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSSEStream', () => {
  it('yields a parsed event when a single SSE data line arrives in one chunk', async () => {
    const body = makeStream([
      sseChunk('data: {"type":"content_block_delta","delta":{"text":"hello"}}'),
    ]);
    const events = await collect(body);
    expect(events).toEqual([{ type: 'content_block_delta', delta: { text: 'hello' } }]);
  });

  it('yields multiple events when several SSE data lines arrive in a single chunk', async () => {
    const body = makeStream([
      sseChunk(
        'data: {"type":"content_block_delta","delta":{"text":"foo"}}',
        'data: {"type":"content_block_delta","delta":{"text":"bar"}}'
      ),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: 'content_block_delta', delta: { text: 'foo' } },
      { type: 'content_block_delta', delta: { text: 'bar' } },
    ]);
  });

  it('reassembles and yields an event when the JSON payload is split across two chunks', async () => {
    // Split the JSON payload mid-way across a chunk boundary.
    const full = 'data: {"type":"content_block_delta","delta":{"text":"split"}}';
    const mid = Math.floor(full.length / 2);
    const body = makeStream([enc.encode(full.slice(0, mid)), enc.encode(`${full.slice(mid)}\n`)]);
    const events = await collect(body);
    expect(events).toEqual([{ type: 'content_block_delta', delta: { text: 'split' } }]);
  });

  it('yields message_stop and then the generator returns', async () => {
    const body = makeStream([
      sseChunk(
        'data: {"type":"content_block_delta","delta":{"text":"t"}}',
        'data: {"type":"message_stop","conversation_id":"test-conv","usage":{"input_tokens":5,"output_tokens":1}}'
      ),
    ]);
    const events = await collect(body);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: 'message_stop',
      conversation_id: 'test-conv',
      usage: { input_tokens: 5, output_tokens: 1 },
    });
  });

  it('stops on [DONE] sentinel without yielding an extra event', async () => {
    const body = makeStream([
      sseChunk(
        'data: {"type":"message_stop","conversation_id":"test-conv","usage":{"input_tokens":1,"output_tokens":1}}',
        'data: [DONE]'
      ),
    ]);
    const events = await collect(body);
    // Only the message_stop event — [DONE] causes return, not a yield.
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('message_stop');
  });

  it('yields error events with their message and code fields intact', async () => {
    const body = makeStream([
      sseChunk('data: {"type":"error","error":{"message":"model offline","code":"stream_error"}}'),
    ]);
    const events = await collect(body);
    expect(events).toEqual([
      { type: 'error', error: { message: 'model offline', code: 'stream_error' } },
    ]);
  });

  it('skips malformed JSON lines and continues yielding subsequent events', async () => {
    const body = makeStream([
      sseChunk(
        'data: not-valid-json',
        'data: {"type":"content_block_delta","delta":{"text":"after"}}'
      ),
    ]);
    const events = await collect(body);
    expect(events).toEqual([{ type: 'content_block_delta', delta: { text: 'after' } }]);
  });

  it('ignores blank and comment lines', async () => {
    const body = makeStream([
      sseChunk('', ': keep-alive', 'data: {"type":"content_block_start"}', ''),
    ]);
    const events = await collect(body);
    expect(events).toEqual([{ type: 'content_block_start' }]);
  });

  it('skips non-data non-comment lines (e.g. id: fields) without yielding', async () => {
    // SSE spec allows field lines like "id: 42" or "retry: 3000" that are not
    // "data:" lines. These must be silently skipped.
    const body = makeStream([
      sseChunk('id: 42', 'retry: 3000', 'data: {"type":"content_block_start"}'),
    ]);
    const events = await collect(body);
    expect(events).toEqual([{ type: 'content_block_start' }]);
  });

  it('skips non-object JSON payloads (arrays, strings, numbers)', async () => {
    // Payloads that parse to non-objects (missing 'type' field) must be skipped.
    const body = makeStream([
      sseChunk(
        'data: ["not","an","object"]',
        'data: "just a string"',
        'data: {"type":"content_block_stop"}'
      ),
    ]);
    const events = await collect(body);
    expect(events).toEqual([{ type: 'content_block_stop' }]);
  });
});
