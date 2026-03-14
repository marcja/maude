/**
 * src/mocks/handlers/conversations.ts
 *
 * MSW handlers for the conversation API routes (/api/conversations).
 * Used by HistoryPane tests (T22) before the real API routes exist (T26).
 *
 * Three endpoints:
 *   GET  /api/conversations      → list of conversations (newest first)
 *   GET  /api/conversations/:id  → { messages: Message[] }
 *   DELETE /api/conversations/:id → 204 No Content
 */

import { http, HttpResponse } from 'msw';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

export const FIXTURE_CONVERSATIONS = [
  {
    id: 'conv-1',
    title: 'First conversation',
    created_at: 1700000000000,
    updated_at: 1700000200000,
  },
  {
    id: 'conv-2',
    title: 'Second conversation',
    created_at: 1700000100000,
    updated_at: 1700000300000,
  },
];

export const FIXTURE_MESSAGES = [
  {
    id: 'msg-1',
    conversation_id: 'conv-1',
    role: 'user' as const,
    content: 'Hello there',
    thinking: null,
    created_at: 1700000000000,
  },
  {
    id: 'msg-2',
    conversation_id: 'conv-1',
    role: 'assistant' as const,
    content: 'Hi! How can I help?',
    thinking: null,
    created_at: 1700000001000,
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Returns the fixture conversations list (newest first by updated_at). */
export const conversationsListHandler = http.get('/api/conversations', () => {
  // Sort newest first, matching the real API behavior (ORDER BY updated_at DESC)
  const sorted = [...FIXTURE_CONVERSATIONS].sort((a, b) => b.updated_at - a.updated_at);
  return HttpResponse.json(sorted);
});

/** Returns an empty conversations list. */
export const emptyConversationsHandler = http.get('/api/conversations', () => {
  return HttpResponse.json([]);
});

/** Returns messages for a given conversation ID. */
export const conversationMessagesHandler = http.get('/api/conversations/:id', ({ params }) => {
  const { id } = params;
  const messages = FIXTURE_MESSAGES.filter((m) => m.conversation_id === id);
  return HttpResponse.json({ messages });
});

/** Deletes a conversation — returns 204. */
export const conversationDeleteHandler = http.delete('/api/conversations/:id', () => {
  return new HttpResponse(null, { status: 204 });
});

/** Returns a 500 error for the conversations list. */
export const conversationsErrorHandler = http.get('/api/conversations', () => {
  return HttpResponse.json({ error: 'Internal server error' }, { status: 500 });
});
