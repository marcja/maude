/**
 * src/components/chat/__tests__/MessageItem.test.tsx
 *
 * Tests for the MessageItem component.
 * MessageItem is a pure presentational component — no hooks, no fetch —
 * so the default jsdom environment is sufficient here.
 *
 * Why @testing-library/react render + screen: MessageItem renders JSX, and
 * RTL's queries let us assert on what the user sees without coupling to
 * implementation details like class names or element hierarchy.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageItem } from '../MessageItem';

// ---------------------------------------------------------------------------
// Suite 1: user message
// ---------------------------------------------------------------------------

describe('MessageItem — user message', () => {
  it('renders the message content', () => {
    render(<MessageItem sender="user" content="Hello there" />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('does not render a TTFT badge', () => {
    render(<MessageItem sender="user" content="Hi" ttft={100} />);
    // Even if ttft is passed, user messages do not display it
    expect(screen.queryByText(/↯/)).not.toBeInTheDocument();
  });

  it('does not render a copy button', () => {
    render(<MessageItem sender="user" content="Hi" />);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('does not show a streaming spinner', () => {
    render(<MessageItem sender="user" content="Hi" isStreaming={true} />);
    expect(screen.queryByLabelText('Streaming indicator')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: assistant message with TTFT badge
// ---------------------------------------------------------------------------

describe('MessageItem — assistant message TTFT badge', () => {
  it('renders the TTFT badge when ttft is provided', () => {
    render(<MessageItem sender="assistant" content="Hello" ttft={312} />);
    expect(screen.getByText('↯ 312ms')).toBeInTheDocument();
  });

  it('rounds fractional ttft values', () => {
    render(<MessageItem sender="assistant" content="Hello" ttft={312.7} />);
    expect(screen.getByText('↯ 313ms')).toBeInTheDocument();
  });

  it('does not render a TTFT badge when ttft is null', () => {
    render(<MessageItem sender="assistant" content="Hello" ttft={null} />);
    expect(screen.queryByText(/↯/)).not.toBeInTheDocument();
  });

  it('does not render a TTFT badge when ttft is omitted', () => {
    render(<MessageItem sender="assistant" content="Hello" />);
    expect(screen.queryByText(/↯/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: copy button
// ---------------------------------------------------------------------------

describe('MessageItem — copy button', () => {
  beforeEach(() => {
    // jsdom does not implement clipboard API; provide a mock
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('renders a copy button on assistant messages', () => {
    render(<MessageItem sender="assistant" content="Some response" />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('calls clipboard.writeText with the message content when clicked', async () => {
    render(<MessageItem sender="assistant" content="Copy this text" />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy this text');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Markdown rendering (T13 upgrade)
// ---------------------------------------------------------------------------

describe('MessageItem — markdown rendering', () => {
  it('renders assistant markdown content as rich HTML (not plain text)', () => {
    render(<MessageItem sender="assistant" content="**bold text**" />);
    // StreamingMarkdown wraps react-markdown, which renders **bold** as <strong>
    expect(screen.getByText('bold text').tagName.toLowerCase()).toBe('strong');
  });

  it('renders user messages as plain text (no markdown processing)', () => {
    render(<MessageItem sender="user" content="**not bold**" />);
    // User messages stay as plain text — the literal asterisks are shown
    expect(screen.getByText('**not bold**')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: streaming spinner
// ---------------------------------------------------------------------------

describe('MessageItem — streaming spinner', () => {
  it('shows the spinner when isStreaming is true', () => {
    render(<MessageItem sender="assistant" content="" isStreaming={true} />);
    expect(screen.getByLabelText('Streaming indicator')).toBeInTheDocument();
  });

  it('hides the spinner when isStreaming is false', () => {
    render(<MessageItem sender="assistant" content="Done" isStreaming={false} />);
    expect(screen.queryByLabelText('Streaming indicator')).not.toBeInTheDocument();
  });

  it('hides the spinner when isStreaming is omitted', () => {
    render(<MessageItem sender="assistant" content="Done" />);
    expect(screen.queryByLabelText('Streaming indicator')).not.toBeInTheDocument();
  });
});
