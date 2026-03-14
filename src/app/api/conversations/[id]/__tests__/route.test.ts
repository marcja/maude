/**
 * @jest-environment node
 *
 * Tests for GET /api/conversations/[id] and DELETE /api/conversations/[id].
 * DB functions are mocked — no filesystem access needed.
 */

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so jest hoists them
// ---------------------------------------------------------------------------

jest.mock('../../../../../lib/server/db', () => ({
  getConversation: jest.fn(),
  getMessages: jest.fn(() => []),
  deleteConversation: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { ConversationRow, MessageRow } from '../../../../../lib/server/db';
import { deleteConversation, getConversation, getMessages } from '../../../../../lib/server/db';
import { DELETE, GET } from '../route';

const mockGetConversation = getConversation as jest.MockedFunction<typeof getConversation>;
const mockGetMessages = getMessages as jest.MockedFunction<typeof getMessages>;
const mockDeleteConversation = deleteConversation as jest.MockedFunction<typeof deleteConversation>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Next.js dynamic route params are passed as a promise in App Router. */
function routeContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** Reusable fixture — avoids duplicating the same object in every test. */
const FIXTURE_CONVERSATION: ConversationRow = {
  id: 'c1',
  title: 'Test',
  created_at: 1000,
  updated_at: 2000,
};

// ---------------------------------------------------------------------------
// Suite 1: GET /api/conversations/[id]
// ---------------------------------------------------------------------------

describe('GET /api/conversations/[id]', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns messages for an existing conversation', async () => {
    const messages: MessageRow[] = [
      {
        id: 'm1',
        conversation_id: 'c1',
        role: 'user',
        content: 'Hello',
        thinking: null,
        created_at: 1000,
      },
      {
        id: 'm2',
        conversation_id: 'c1',
        role: 'assistant',
        content: 'Hi!',
        thinking: null,
        created_at: 1001,
      },
    ];
    mockGetConversation.mockReturnValueOnce(FIXTURE_CONVERSATION);
    mockGetMessages.mockReturnValueOnce(messages);

    const response = await GET(
      new Request('http://localhost/api/conversations/c1'),
      routeContext('c1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
  });

  it('returns 404 when conversation does not exist', async () => {
    mockGetConversation.mockReturnValueOnce(undefined);

    const response = await GET(
      new Request('http://localhost/api/conversations/nonexistent'),
      routeContext('nonexistent')
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it('does not call getMessages when conversation is missing', async () => {
    mockGetConversation.mockReturnValueOnce(undefined);

    await GET(new Request('http://localhost/api/conversations/missing'), routeContext('missing'));

    expect(mockGetMessages).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: DELETE /api/conversations/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/conversations/[id]', () => {
  afterEach(() => jest.clearAllMocks());

  it('deletes an existing conversation and returns 204 with empty body', async () => {
    mockGetConversation.mockReturnValueOnce(FIXTURE_CONVERSATION);

    const response = await DELETE(
      new Request('http://localhost/api/conversations/c1', { method: 'DELETE' }),
      routeContext('c1')
    );

    expect(response.status).toBe(204);
    expect(mockDeleteConversation).toHaveBeenCalledWith('c1');
    const text = await response.text();
    expect(text).toBe('');
  });

  it('returns 404 when conversation does not exist', async () => {
    mockGetConversation.mockReturnValueOnce(undefined);

    const response = await DELETE(
      new Request('http://localhost/api/conversations/nonexistent', { method: 'DELETE' }),
      routeContext('nonexistent')
    );

    expect(response.status).toBe(404);
    expect(mockDeleteConversation).not.toHaveBeenCalled();
  });
});
