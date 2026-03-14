/**
 * @jest-environment ./jest-environment-with-fetch.js
 *
 * Custom environment required because MSW 2.x references WinterCG fetch
 * globals (Response, Request) at module-load time, which jest-environment-jsdom
 * doesn't provide.
 */

/**
 * src/app/chat/__tests__/page.test.tsx
 *
 * Integration tests for the ChatPage orchestration component.
 *
 * ChatPage is the most complex component in the app — it wires together
 * useObservabilityEvents (streaming), useAutoScroll, useStallDetection,
 * HistoryPane, and ObservabilityPane. Individual hooks and components are
 * well-tested in isolation; these tests verify the integration seams:
 *   - handleSubmit constructs the correct message context
 *   - appendAssistant finalizes history and sets conversationId
 *   - handleRetry re-sends failedMessages
 *   - handleSelectConversation loads messages from history pane
 *   - handleNewChat clears state
 *
 * All network is MSW-intercepted; no Ollama or real server needed.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import ChatShell from '../../../components/chat/ChatShell';
import { ObservabilityProvider } from '../../../context/ObservabilityContext';
import type { SSEEvent } from '../../../lib/client/events';
import type { ConversationSummary } from '../../../lib/shared/types';
import {
  FIXTURE_CONVERSATIONS,
  FIXTURE_MESSAGES,
  conversationMessagesHandler,
  conversationsListHandler,
  emptyConversationsHandler,
} from '../../../mocks/handlers/conversations';
import { holdHandler } from '../../../mocks/handlers/hold';
import { midstreamErrorHandler } from '../../../mocks/handlers/midstream-error';
import { normalHandler } from '../../../mocks/handlers/normal';
import { server, setupMSWServer } from '../../../mocks/server';
import { encodeEvent } from '../../../mocks/utils';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

setupMSWServer();

// ---------------------------------------------------------------------------
// crypto.randomUUID mock — jsdom may not have it
// ---------------------------------------------------------------------------

let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  if (!crypto.randomUUID) {
    Object.defineProperty(crypto, 'randomUUID', {
      value: () => '',
      writable: true,
      configurable: true,
    });
  }
  jest.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    uuidCounter += 1;
    // Cast: mock returns a sequential string for deterministic assertions.
    return `test-uuid-${uuidCounter}` as ReturnType<typeof crypto.randomUUID>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wraps ChatShell with ObservabilityProvider — required by useObservabilityEvents. */
function renderChatPage(
  initialConversations: ConversationSummary[] = [],
  extraProps: Partial<React.ComponentProps<typeof ChatShell>> = {}
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <ObservabilityProvider>{children}</ObservabilityProvider>;
  }
  return render(<ChatShell initialConversations={initialConversations} {...extraProps} />, {
    wrapper: Wrapper,
  });
}

/** Type a message into the chat input and press Enter to submit. */
async function submitMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  const textarea = screen.getByRole('textbox');
  await user.type(textarea, `${text}{Enter}`);
}

/**
 * Creates an MSW handler that captures the request body and returns a normal
 * SSE stream, so tests can inspect what the page serialized.
 */
function createCapturingHandler(conversationId = 'captured-conv-id') {
  let capturedBody: Record<string, unknown> | null = null;
  const encoder = new TextEncoder();
  const handler = http.post('/api/chat', async ({ request }) => {
    capturedBody = (await request.json()) as Record<string, unknown>;
    const events: SSEEvent[] = [
      { type: 'message_start', message_id: 'capture-msg' },
      { type: 'content_block_start' },
      { type: 'content_block_delta', delta: { text: 'Reply' } },
      { type: 'content_block_stop' },
      {
        type: 'message_stop',
        conversation_id: conversationId,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  return { handler, getCapturedBody: () => capturedBody };
}

// ---------------------------------------------------------------------------
// Suite 1: handleSubmit flow
// ---------------------------------------------------------------------------

describe('ChatPage — handleSubmit', () => {
  it('adds user message to history and shows assistant response after stream completes', async () => {
    server.use(normalHandler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    await submitMessage(user, 'Hello');

    // User message appears immediately
    expect(screen.getByText('Hello')).toBeInTheDocument();

    // Assistant response arrives after stream completes
    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
  });

  it('constructs the correct message context from history', async () => {
    const { handler, getCapturedBody } = createCapturingHandler();
    server.use(handler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    await submitMessage(user, 'First question');
    await waitFor(() => expect(screen.getByText('Reply')).toBeInTheDocument());

    // Second message — context should include all prior messages
    const { handler: handler2, getCapturedBody: getCapturedBody2 } =
      createCapturingHandler('conv-2');
    server.use(handler2);

    await submitMessage(user, 'Follow up');
    await waitFor(() => expect(getCapturedBody2()).not.toBeNull());

    const body = getCapturedBody2();
    // Context should contain: first user + first assistant + second user
    const messages = body?.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'First question' });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Reply' });
    expect(messages[2]).toEqual({ role: 'user', content: 'Follow up' });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: appendAssistant (stream finalization)
// ---------------------------------------------------------------------------

describe('ChatPage — stream finalization', () => {
  it('sets activeConversationId and sends it on subsequent requests', async () => {
    const { handler: firstHandler } = createCapturingHandler('server-conv-id');
    server.use(firstHandler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    await submitMessage(user, 'Hello');
    await waitFor(() => expect(screen.getByText('Reply')).toBeInTheDocument());

    // Second send should include the conversationId from the first response
    const { handler: secondHandler, getCapturedBody } = createCapturingHandler('server-conv-id');
    server.use(secondHandler);

    await submitMessage(user, 'Next');
    await waitFor(() => expect(getCapturedBody()).not.toBeNull());

    expect(getCapturedBody()?.conversationId).toBe('server-conv-id');
  });
});

// ---------------------------------------------------------------------------
// Suite 3: handleRetry
// ---------------------------------------------------------------------------

describe('ChatPage — handleRetry', () => {
  it('shows error banner with Retry button on stream error', async () => {
    server.use(midstreamErrorHandler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    await submitMessage(user, 'Trigger error');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('clicking Retry re-sends the failed request and clears error on success', async () => {
    server.use(midstreamErrorHandler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    await submitMessage(user, 'Trigger error');
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // Swap handler to succeed on retry
    server.use(normalHandler);
    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
    // Error should be cleared
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: handleSelectConversation
// ---------------------------------------------------------------------------

describe('ChatPage — handleSelectConversation', () => {
  it('loads messages from history pane into the chat', async () => {
    server.use(conversationsListHandler, conversationMessagesHandler);
    const user = userEvent.setup();
    renderChatPage();

    // Expand history pane via the "View history" icon in the collapsed sidebar
    await user.click(screen.getByRole('button', { name: /view history/i }));

    // Wait for conversations to load
    await waitFor(() => {
      expect(screen.getByText('First conversation')).toBeInTheDocument();
    });

    // Click a conversation to load its messages
    await user.click(screen.getByText('First conversation'));

    // Messages from the fixture should appear in the chat
    await waitFor(() => {
      expect(screen.getByText('Hello there')).toBeInTheDocument();
      expect(screen.getByText('Hi! How can I help?')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 5: handleNewChat
// ---------------------------------------------------------------------------

describe('ChatPage — handleNewChat', () => {
  it('clears history when New Chat is clicked', async () => {
    server.use(normalHandler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    // Send a message so history is non-empty
    await submitMessage(user, 'Hello');
    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());

    // Click "New chat" via the sidebar icon button (first match; InputArea has another)
    const newChatButtons = screen.getAllByRole('button', { name: /^new chat$/i });
    await user.click(newChatButtons[0]);

    // History should be cleared — assistant message gone
    await waitFor(() => {
      expect(screen.queryByText('Hello world')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: UI integration
// ---------------------------------------------------------------------------

describe('ChatPage — UI integration', () => {
  it('renders sidebar with settings link', () => {
    server.use(emptyConversationsHandler);
    renderChatPage();

    // Settings link is in the sidebar icon strip
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings');
  });

  it('toggles the debug pane when debug icon is clicked', async () => {
    server.use(emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    const debugButton = screen.getByRole('button', { name: /expand debug pane/i });

    // Click to expand
    await user.click(debugButton);

    // Expanded pane shows tabs
    await waitFor(() => {
      expect(screen.getByText('Metrics')).toBeInTheDocument();
    });
  });

  it('stops active stream when selecting a conversation from history', async () => {
    // Increased timeout: this test starts a stream, opens the history pane,
    // selects a conversation, and waits for the stream to abort — multiple
    // async round-trips that can exceed 5s under full-suite CI load.
    // Start with a hold handler so the stream stays open
    server.use(holdHandler, conversationsListHandler, conversationMessagesHandler);
    const user = userEvent.setup();
    renderChatPage();

    // Start a stream
    await submitMessage(user, 'Stalling request');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    });

    // Expand history pane and select a conversation — should stop the stream
    await user.click(screen.getByRole('button', { name: /view history/i }));
    await waitFor(() => expect(screen.getByText('First conversation')).toBeInTheDocument());
    await user.click(screen.getByText('First conversation'));

    // Stream should have stopped — no more Stop button
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    });

    // Loaded conversation messages should appear
    await waitFor(() => {
      expect(screen.getByText('Hello there')).toBeInTheDocument();
    });
  }, 15000);
});

// ---------------------------------------------------------------------------
// Suite 7: Server-to-client data flow (initialConversations prop)
// ---------------------------------------------------------------------------

describe('ChatPage — initialConversations prop', () => {
  it('passes initialConversations to HistoryPane so conversations render without fetch', async () => {
    // Use a conversations handler that never responds — if HistoryPane
    // relied solely on the fetch, the pane would show "Loading…" forever.
    // With initialConversations, the data is visible immediately.
    server.use(
      http.get('/api/conversations', () => {
        // Never resolve — simulates a slow network
        return new Promise(() => {});
      }),
      conversationMessagesHandler
    );
    const user = userEvent.setup();
    renderChatPage(FIXTURE_CONVERSATIONS);

    // Expand history pane via the "View history" icon in the collapsed sidebar
    await user.click(screen.getByRole('button', { name: /view history/i }));

    // Conversations from the prop should be visible immediately even though
    // the fetch is still in-flight. This proves the server component's
    // initialConversations prop eliminates the loading flash.
    expect(screen.getByText('First conversation')).toBeInTheDocument();
    expect(screen.getByText('Second conversation')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 8: URL-based conversation routing
// ---------------------------------------------------------------------------

describe('ChatPage — URL sync', () => {
  let pushStateSpy: jest.SpyInstance;
  let replaceStateSpy: jest.SpyInstance;

  beforeEach(() => {
    pushStateSpy = jest.spyOn(window.history, 'pushState').mockImplementation(() => {});
    replaceStateSpy = jest.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  });

  afterEach(() => {
    pushStateSpy.mockRestore();
    replaceStateSpy.mockRestore();
  });

  it('calls replaceState with /chat/{id} after the first message completes', async () => {
    const { handler } = createCapturingHandler('new-conv-id');
    server.use(handler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    await submitMessage(user, 'Hello');
    await waitFor(() => expect(screen.getByText('Reply')).toBeInTheDocument());

    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/chat/new-conv-id');
  });

  it('calls pushState with /chat/{id} when selecting a conversation', async () => {
    server.use(conversationsListHandler, conversationMessagesHandler);
    const user = userEvent.setup();
    renderChatPage();

    // Expand history pane and select a conversation
    await user.click(screen.getByRole('button', { name: /view history/i }));
    await waitFor(() => expect(screen.getByText('First conversation')).toBeInTheDocument());
    await user.click(screen.getByText('First conversation'));

    await waitFor(() => {
      expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/chat/conv-1');
    });
  });

  it('calls pushState with /chat when clicking New Chat', async () => {
    server.use(normalHandler, emptyConversationsHandler);
    const user = userEvent.setup();
    renderChatPage();

    // Send a message so we have an active conversation
    await submitMessage(user, 'Hello');
    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());

    // Click "New chat"
    const newChatButtons = screen.getAllByRole('button', { name: /^new chat$/i });
    await user.click(newChatButtons[0]);

    expect(pushStateSpy).toHaveBeenCalledWith(null, '', '/chat');
  });

  it('renders pre-fetched messages from initialMessages prop', () => {
    server.use(emptyConversationsHandler);
    renderChatPage([], {
      initialConversationId: 'conv-abc',
      initialConversationTitle: 'Pre-fetched conversation',
      initialMessages: FIXTURE_MESSAGES.map((m) => ({
        ...m,
        conversation_id: 'conv-abc',
      })),
    });

    // Messages should appear immediately without any fetch
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(screen.getByText('Hi! How can I help?')).toBeInTheDocument();
    // Title should be displayed in the header
    expect(screen.getByText('Pre-fetched conversation')).toBeInTheDocument();
  });
});
