/**
 * jest-environment-with-fetch.js
 *
 * Custom Jest environment that extends jest-environment-jsdom and injects
 * Node 18+ WinterCG fetch globals (fetch, Request, Response, Headers,
 * ReadableStream, etc.) into the jsdom sandbox before any test module loads.
 *
 * Why this is needed: MSW 2.x references `Response`, `TextEncoder`, and
 * `BroadcastChannel` at module-load time. jest-environment-jsdom creates a
 * vm sandbox whose global object is jsdom's Window, which does not expose
 * Node 18+'s native fetch globals. Capturing them from the outer Node process
 * before super() runs and injecting them via this.global makes them visible
 * inside the sandbox to both MSW internals and the hook under test.
 *
 * The 'customExportConditions' needed for msw/node subpath resolution is set
 * in jest.config.js testEnvironmentOptions so the resolver picks it up before
 * any module is imported; it does not need to live here.
 *
 * Usage: add `@jest-environment ./jest-environment-with-fetch.js` to any
 * test file that uses MSW with jsdom (i.e. client hook tests).
 */

const { TestEnvironment } = require('jest-environment-jsdom');

// Capture Node.js WinterCG globals from the outer process context BEFORE
// TestEnvironment's super() call makes `global` point to jsdom's Window.
// In Node 18+ these are natively available on the process globalThis.
const captured = {
  fetch: global.fetch,
  Request: global.Request,
  Response: global.Response,
  Headers: global.Headers,
  ReadableStream: global.ReadableStream,
  WritableStream: global.WritableStream,
  TransformStream: global.TransformStream,
  TextEncoder: global.TextEncoder,
  TextDecoder: global.TextDecoder,
  Blob: global.Blob,
  File: global.File,
  FormData: global.FormData,
  crypto: global.crypto,
  BroadcastChannel: global.BroadcastChannel,
  MessageChannel: global.MessageChannel,
  MessageEvent: global.MessageEvent,
};

class FetchEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);

    // Inject captured Node.js fetch globals into the jsdom vm context.
    // Only inject values that actually exist in Node (guard avoids overwriting
    // jsdom's own implementations with undefined on older Node versions).
    for (const [key, value] of Object.entries(captured)) {
      if (value !== undefined) {
        this.global[key] = value;
      }
    }
  }
}

module.exports = FetchEnvironment;
