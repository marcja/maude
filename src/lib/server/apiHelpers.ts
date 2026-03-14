/**
 * src/lib/server/apiHelpers.ts
 *
 * Shared utilities for Next.js API route handlers. Extracted from chat and
 * settings routes to eliminate duplication of the ValidationError class and
 * the JSON response construction pattern.
 *
 * Why server-only: these helpers use Node's Response constructor and are
 * only meaningful inside API route handlers. The 'server-only' guard
 * prevents accidental client-side imports.
 */

import 'server-only';

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

/**
 * Thrown by route-level validate* functions when the request body fails
 * shape checks. Caught in the route handler to return a 400 JSON response
 * before any business logic runs.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Shorthand for a JSON success or error response. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
