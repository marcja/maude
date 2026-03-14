/**
 * src/app/chat/[id]/__tests__/page.test.tsx
 *
 * Tests for the ChatByIdPage server component. Verifies:
 *   - Valid conversation ID renders ChatShell with correct props
 *   - Invalid conversation ID calls notFound()
 */

import { render, screen } from '@testing-library/react';
import ChatByIdPage from '../page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// notFound must throw to halt execution (matching Next.js runtime behavior).
const NOT_FOUND_ERROR = Symbol('notFound');
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw NOT_FOUND_ERROR;
  }),
}));

const mockConversation = {
  id: 'conv-abc',
  title: 'Test conversation',
  created_at: 1700000000000,
  updated_at: 1700000200000,
};

const mockMessages = [
  {
    id: 'msg-1',
    conversation_id: 'conv-abc',
    role: 'user' as const,
    content: 'Hello',
    thinking: null,
    created_at: 1700000000000,
  },
  {
    id: 'msg-2',
    conversation_id: 'conv-abc',
    role: 'assistant' as const,
    content: 'Hi there!',
    thinking: null,
    created_at: 1700000001000,
  },
];

const mockConversations = [mockConversation];

jest.mock('../../../../lib/server/db', () => ({
  getConversation: jest.fn((id: string) => (id === 'conv-abc' ? mockConversation : undefined)),
  getConversations: jest.fn(() => mockConversations),
  getMessages: jest.fn(() => mockMessages),
}));

// Capture the last props passed to ChatShell so tests can assert on them.
let lastChatShellProps: Record<string, unknown> | null = null;

jest.mock('../../../../components/chat/ChatShell', () => {
  function MockChatShell(props: Record<string, unknown>) {
    lastChatShellProps = props;
    return <div data-testid="chat-shell" />;
  }
  MockChatShell.displayName = 'MockChatShell';
  return { __esModule: true, default: MockChatShell };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatByIdPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastChatShellProps = null;
  });

  it('renders ChatShell with correct props for a valid conversation ID', async () => {
    const element = await ChatByIdPage({ params: Promise.resolve({ id: 'conv-abc' }) });
    render(element);

    expect(screen.getByTestId('chat-shell')).toBeInTheDocument();
    expect(lastChatShellProps).toMatchObject({
      initialConversationId: 'conv-abc',
      initialConversationTitle: 'Test conversation',
      initialMessages: mockMessages,
      initialConversations: mockConversations,
    });
  });

  it('calls notFound() for a non-existent conversation ID', async () => {
    try {
      await ChatByIdPage({ params: Promise.resolve({ id: 'nonexistent' }) });
    } catch (e) {
      expect(e).toBe(NOT_FOUND_ERROR);
    }

    const { notFound } = jest.requireMock('next/navigation') as { notFound: jest.Mock };
    expect(notFound).toHaveBeenCalled();
  });
});
