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
  it('displays the text content of a user message', () => {
    render(<MessageItem sender="user" content="Hello there" />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('never shows a TTFT badge, even when a ttft value is provided', () => {
    render(<MessageItem sender="user" content="Hi" ttft={100} />);
    // Even if ttft is passed, user messages do not display it
    expect(screen.queryByText(/↯/)).not.toBeInTheDocument();
  });

  it('does not offer a copy button for user messages', () => {
    render(<MessageItem sender="user" content="Hi" />);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('does not display a streaming indicator for user messages', () => {
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

  it('rounds fractional ttft values to the nearest integer in the badge', () => {
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

  it('renders the TTFT badge when ttft is 0 (falsy but valid)', () => {
    // 0 is falsy in JS but a valid TTFT — the != null guard must not swallow it
    render(<MessageItem sender="assistant" content="Hello" ttft={0} />);
    expect(screen.getByText('↯ 0ms')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: copy button
// ---------------------------------------------------------------------------

describe('MessageItem — copy button', () => {
  beforeEach(() => {
    // jsdom does not implement clipboard API; provide a mock.
    // configurable: true ensures afterEach can delete it cleanly.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    // Reset to undefined — jsdom's navigator.clipboard is undefined by default,
    // so this restores the original state without needing to capture it ahead
    // of time. Object.defineProperty is required because clipboard is readonly.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
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

  it('calls onCopy callback when copy button is clicked', async () => {
    const onCopy = jest.fn();
    render(<MessageItem sender="assistant" content="Copy me" onCopy={onCopy} />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    // Both clipboard write and onCopy must fire — a refactor that breaks
    // either side should fail this test.
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy me');
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('does not fail when onCopy is omitted and copy is clicked', async () => {
    render(<MessageItem sender="assistant" content="No callback" />);
    await userEvent.click(screen.getByRole('button', { name: /copy/i }));
    // Should not throw — onCopy is optional
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('No callback');
  });
});

// ---------------------------------------------------------------------------
// Suite 3b: empty assistant content
// ---------------------------------------------------------------------------

describe('MessageItem — empty assistant content', () => {
  it('renders the footer (copy button) even when content is empty', () => {
    // Edge case: stream just started, no tokens arrived yet, and isStreaming
    // has already flipped to false (e.g. immediate error). The bubble and
    // footer should still render without crashing.
    render(<MessageItem sender="assistant" content="" />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
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
// Suite 5: streaming indicator (unified pulsing dot)
// ---------------------------------------------------------------------------

describe('MessageItem — streaming indicator', () => {
  it('shows the indicator when isStreaming is true', () => {
    render(<MessageItem sender="assistant" content="" isStreaming={true} />);
    expect(screen.getByLabelText('Streaming indicator')).toBeInTheDocument();
  });

  it('hides the indicator when isStreaming is false', () => {
    render(<MessageItem sender="assistant" content="Done" isStreaming={false} />);
    expect(screen.queryByLabelText('Streaming indicator')).not.toBeInTheDocument();
  });

  it('hides the indicator when isStreaming is omitted', () => {
    render(<MessageItem sender="assistant" content="Done" />);
    expect(screen.queryByLabelText('Streaming indicator')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: stall indicator inline in footer
// ---------------------------------------------------------------------------

describe('MessageItem — stall indicator', () => {
  it('shows "Still working…" text when stalled', () => {
    render(
      <MessageItem sender="assistant" content="partial" isStreaming={true} isStalled={true} />
    );
    expect(screen.getByText(/Still working…/)).toBeInTheDocument();
  });

  it('does not show "Still working…" when streaming but not stalled', () => {
    render(
      <MessageItem sender="assistant" content="partial" isStreaming={true} isStalled={false} />
    );
    expect(screen.queryByText(/Still working…/)).not.toBeInTheDocument();
  });

  it('renders Cancel button when stalled and onCancel is provided', () => {
    render(
      <MessageItem
        sender="assistant"
        content="partial"
        isStreaming={true}
        isStalled={true}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const handleCancel = jest.fn();
    render(
      <MessageItem
        sender="assistant"
        content="partial"
        isStreaming={true}
        isStalled={true}
        onCancel={handleCancel}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render Cancel button when onCancel is omitted', () => {
    render(
      <MessageItem sender="assistant" content="partial" isStreaming={true} isStalled={true} />
    );
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('keeps the streaming indicator visible when stalled', () => {
    render(
      <MessageItem sender="assistant" content="partial" isStreaming={true} isStalled={true} />
    );
    // The pulsing dot serves as the streaming indicator in both states
    expect(screen.getByLabelText('Streaming indicator')).toBeInTheDocument();
  });

  it('stall content lives inside a live-region element for accessibility', () => {
    render(
      <MessageItem sender="assistant" content="partial" isStreaming={true} isStalled={true} />
    );
    // <output> has implicit role="status" — screen readers announce stall text
    const output = screen.getByLabelText('Streaming indicator');
    expect(output.tagName).toBe('OUTPUT');
    expect(output).toHaveTextContent(/Still working/);
  });
});
