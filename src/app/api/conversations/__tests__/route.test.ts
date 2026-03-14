/**
 * @jest-environment node
 *
 * Tests for GET /api/conversations.
 * DB functions are mocked — no filesystem access needed.
 */

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so jest hoists them
// ---------------------------------------------------------------------------

jest.mock('../../../../lib/server/db', () => ({
  getConversations: jest.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { ConversationRow } from '../../../../lib/server/db';
import { getConversations } from '../../../../lib/server/db';
import { GET } from '../route';

const mockGetConversations = getConversations as jest.MockedFunction<typeof getConversations>;

// ---------------------------------------------------------------------------
// Suite: GET /api/conversations
// ---------------------------------------------------------------------------

describe('GET /api/conversations', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns an empty array when no conversations exist', async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns conversations ordered by updated_at DESC', async () => {
    const conversations: ConversationRow[] = [
      { id: 'c1', title: 'First', created_at: 1000, updated_at: 3000 },
      { id: 'c2', title: 'Second', created_at: 2000, updated_at: 2000 },
    ];
    mockGetConversations.mockReturnValueOnce(conversations);

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('c1');
    expect(body[1].id).toBe('c2');
  });

  it('returns proper Content-Type header', async () => {
    const response = GET();

    expect(response.headers.get('Content-Type')).toBe('application/json');
  });
});
