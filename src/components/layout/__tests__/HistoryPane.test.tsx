/**
 * @jest-environment ./jest-environment-with-fetch.js
 *
 * Custom environment required because MSW 2.x references WinterCG fetch
 * globals (Response, Request) at module-load time, which jest-environment-jsdom
 * doesn't provide.
 */

/**
 * src/components/layout/__tests__/HistoryPane.test.tsx
 *
 * Tests for the HistoryPane component (T22).
 *
 * The pane fetches conversation data from /api/conversations and renders a
 * browsable list. All API calls are intercepted by MSW — no real server needed.
 *
 * Behavior under test:
 *   - Collapsed: 32px strip with vertical "History" label
 *   - Expanded: header with "New Chat" button, conversation list
 *   - Fetches conversations on mount (when expanded)
 *   - Click on conversation fetches messages and calls onSelectConversation
 *   - Delete with window.confirm() confirmation
 *   - Empty state and error state
 *   - Active conversation highlighted
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  FIXTURE_CONVERSATIONS,
  FIXTURE_MESSAGES,
  conversationDeleteHandler,
  conversationMessagesHandler,
  conversationsErrorHandler,
  conversationsListHandler,
  emptyConversationsHandler,
} from '../../../mocks/handlers/conversations';
import { HistoryPane } from '../HistoryPane';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PaneProps {
  collapsed: boolean;
  onToggle: () => void;
  onSelectConversation: jest.Mock;
  onNewChat: jest.Mock;
  activeConversationId: string | null;
}

const defaultProps: PaneProps = {
  collapsed: false,
  onToggle: jest.fn(),
  onSelectConversation: jest.fn(),
  onNewChat: jest.fn(),
  activeConversationId: null,
};

function renderPane(overrides: Partial<PaneProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  // Reset mocks each render so call counts are fresh
  for (const fn of [props.onToggle, props.onSelectConversation, props.onNewChat]) {
    if (jest.isMockFunction(fn)) fn.mockClear();
  }
  return render(<HistoryPane {...props} />);
}

// ---------------------------------------------------------------------------
// Suite 1: Collapse / expand
// ---------------------------------------------------------------------------

describe('HistoryPane — collapse/expand', () => {
  it('shows 32px strip with vertical "History" label when collapsed', () => {
    server.use(emptyConversationsHandler);
    renderPane({ collapsed: true });

    expect(screen.getByText('History')).toBeInTheDocument();
    // No header or conversation list visible
    expect(screen.queryByRole('button', { name: /new chat/i })).not.toBeInTheDocument();
  });

  it('calls onToggle when collapsed strip is clicked', async () => {
    server.use(emptyConversationsHandler);
    const user = userEvent.setup();
    const onToggle = jest.fn();
    renderPane({ collapsed: true, onToggle });

    await user.click(screen.getByRole('button', { name: /expand/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders expanded pane with header and "New Chat" button', async () => {
    server.use(emptyConversationsHandler);
    renderPane({ collapsed: false });

    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Conversation list
// ---------------------------------------------------------------------------

describe('HistoryPane — conversation list', () => {
  it('fetches and displays conversations on mount', async () => {
    server.use(conversationsListHandler);
    renderPane();

    await waitFor(() => {
      expect(screen.getByText('First conversation')).toBeInTheDocument();
      expect(screen.getByText('Second conversation')).toBeInTheDocument();
    });
  });

  it('displays conversations newest-first (by updated_at)', async () => {
    server.use(conversationsListHandler);
    renderPane();

    await waitFor(() => {
      const items = screen.getAllByTestId('conversation-item');
      expect(items).toHaveLength(2);
      // conv-2 has the later updated_at, so it appears first
      expect(within(items[0]).getByText('Second conversation')).toBeInTheDocument();
      expect(within(items[1]).getByText('First conversation')).toBeInTheDocument();
    });
  });

  it('shows empty state message when no conversations exist', async () => {
    server.use(emptyConversationsHandler);
    renderPane();

    await waitFor(() => {
      expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
    });
  });

  it('highlights the active conversation', async () => {
    server.use(conversationsListHandler);
    renderPane({ activeConversationId: 'conv-1' });

    await waitFor(() => {
      const items = screen.getAllByTestId('conversation-item');
      // conv-1 is the second item (conv-2 is first due to sort)
      const activeItem = items[1];
      expect(activeItem).toHaveAttribute('data-active', 'true');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Interactions
// ---------------------------------------------------------------------------

describe('HistoryPane — interactions', () => {
  it('click on conversation fetches messages and calls onSelectConversation', async () => {
    server.use(conversationsListHandler, conversationMessagesHandler);
    const user = userEvent.setup();
    const onSelectConversation = jest.fn();
    renderPane({ onSelectConversation });

    // Wait for list to load
    await waitFor(() => {
      expect(screen.getByText('First conversation')).toBeInTheDocument();
    });

    // Click the first conversation's title button
    await user.click(screen.getByText('First conversation'));

    await waitFor(() => {
      expect(onSelectConversation).toHaveBeenCalledTimes(1);
      expect(onSelectConversation).toHaveBeenCalledWith('conv-1', FIXTURE_MESSAGES);
    });
  });

  it('"New Chat" button calls onNewChat', async () => {
    server.use(emptyConversationsHandler);
    const user = userEvent.setup();
    const onNewChat = jest.fn();
    renderPane({ onNewChat });

    await user.click(screen.getByRole('button', { name: /new chat/i }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('delete button confirms then deletes and refetches list', async () => {
    server.use(conversationsListHandler, conversationDeleteHandler);
    const user = userEvent.setup();

    // Mock window.confirm to return true
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    renderPane();

    // Wait for list to load
    await waitFor(() => {
      expect(screen.getAllByTestId('conversation-item')).toHaveLength(2);
    });

    // After delete, the list should refetch. Swap the handler to return one less.
    server.use(
      http.get('/api/conversations', () => {
        return HttpResponse.json([FIXTURE_CONVERSATIONS[1]]);
      })
    );

    // Click the delete button on the first item
    const items = screen.getAllByTestId('conversation-item');
    const deleteBtn = within(items[0]).getByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getAllByTestId('conversation-item')).toHaveLength(1);
    });

    confirmSpy.mockRestore();
  });

  it('delete confirmation cancelled does not delete', async () => {
    server.use(conversationsListHandler);
    const user = userEvent.setup();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    renderPane();

    await waitFor(() => {
      expect(screen.getAllByTestId('conversation-item')).toHaveLength(2);
    });

    const items = screen.getAllByTestId('conversation-item');
    const deleteBtn = within(items[0]).getByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // List should remain unchanged
    expect(screen.getAllByTestId('conversation-item')).toHaveLength(2);

    confirmSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Error handling
// ---------------------------------------------------------------------------

describe('HistoryPane — error handling', () => {
  it('shows error message if fetch fails', async () => {
    server.use(conversationsErrorHandler);
    renderPane();

    await waitFor(() => {
      expect(screen.getByText(/failed to load conversations/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 7: refreshToken re-fetch (B2)
// ---------------------------------------------------------------------------

describe('HistoryPane — refreshToken', () => {
  it('re-fetches conversations when refreshToken changes', async () => {
    let fetchCount = 0;
    server.use(
      http.get('/api/conversations', () => {
        fetchCount++;
        return HttpResponse.json(FIXTURE_CONVERSATIONS);
      })
    );

    const { rerender } = render(<HistoryPane {...defaultProps} refreshToken={0} />);

    // Initial mount fetch
    await waitFor(() => expect(fetchCount).toBe(1));

    // Increment refreshToken → triggers re-fetch
    rerender(<HistoryPane {...defaultProps} refreshToken={1} />);
    await waitFor(() => expect(fetchCount).toBe(2));
  });

  it('does not re-fetch when collapsed and refreshToken changes', async () => {
    let fetchCount = 0;
    server.use(
      http.get('/api/conversations', () => {
        fetchCount++;
        return HttpResponse.json(FIXTURE_CONVERSATIONS);
      })
    );

    const { rerender } = render(<HistoryPane {...defaultProps} collapsed refreshToken={0} />);

    // Collapsed — no initial fetch
    expect(fetchCount).toBe(0);

    // Increment refreshToken while collapsed — still no fetch
    rerender(<HistoryPane {...defaultProps} collapsed refreshToken={1} />);

    // Give a tick for any potential async effects
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCount).toBe(0);
  });
});
