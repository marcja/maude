/**
 * src/components/chat/__tests__/ThinkingBlock.test.tsx
 *
 * Tests for the ThinkingBlock component.
 * ThinkingBlock is a pure presentational component — no hooks, no fetch —
 * so the default jsdom environment is sufficient.
 *
 * Behavior under test:
 *   - Renders nothing when no thinking content is present (text='' and not streaming)
 *   - Shows "Thinking…" label while the thinking stream is active
 *   - Shows "Thought for Xs" label on completion, where X = elapsed seconds
 *   - Collapsed by default after completion
 *   - Expands/collapses on click (toggle)
 *   - Content is only visible when expanded
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThinkingBlock } from '../ThinkingBlock';

// ---------------------------------------------------------------------------
// Suite 1: renders nothing when there is no thinking content
// ---------------------------------------------------------------------------

describe('ThinkingBlock — empty state', () => {
  it('renders nothing when text is empty and not streaming', () => {
    const { container } = render(<ThinkingBlock text="" isThinking={false} durationMs={null} />);
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: streaming / "Thinking…" state
// ---------------------------------------------------------------------------

describe('ThinkingBlock — streaming state', () => {
  it('renders "Thinking…" label while isThinking is true', () => {
    render(<ThinkingBlock text="partial reason" isThinking={true} durationMs={null} />);
    expect(screen.getByText(/Thinking…/)).toBeInTheDocument();
  });

  it('renders even when text is empty but isThinking is true', () => {
    render(<ThinkingBlock text="" isThinking={true} durationMs={null} />);
    expect(screen.getByText(/Thinking…/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: completed state — "Thought for Xs" label
// ---------------------------------------------------------------------------

describe('ThinkingBlock — completed state', () => {
  it('renders "Thought for Xs" when isThinking is false and durationMs is set', () => {
    render(<ThinkingBlock text="my reasoning" isThinking={false} durationMs={3200} />);
    // "Thought for 3s" — rounded to whole seconds
    expect(screen.getByText(/Thought for 3s/)).toBeInTheDocument();
  });

  it('rounds durationMs to whole seconds', () => {
    render(<ThinkingBlock text="reason" isThinking={false} durationMs={1999} />);
    expect(screen.getByText(/Thought for 1s/)).toBeInTheDocument();
  });

  it('shows "Thought for 0s" for very short durations', () => {
    render(<ThinkingBlock text="quick" isThinking={false} durationMs={500} />);
    expect(screen.getByText(/Thought for 0s/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: collapse/expand behavior
// ---------------------------------------------------------------------------

describe('ThinkingBlock — collapse/expand', () => {
  it('is collapsed by default after completion', () => {
    render(<ThinkingBlock text="hidden reason" isThinking={false} durationMs={1000} />);
    // The thinking content should not be visible in the default collapsed state
    expect(screen.queryByText('hidden reason')).not.toBeInTheDocument();
  });

  it('expands to show content when the header is clicked', async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock text="revealed reason" isThinking={false} durationMs={2000} />);

    // Click the header/toggle to expand
    await user.click(screen.getByRole('button'));

    expect(screen.getByText('revealed reason')).toBeInTheDocument();
  });

  it('collapses again when the header is clicked a second time', async () => {
    const user = userEvent.setup();
    render(<ThinkingBlock text="toggle content" isThinking={false} durationMs={1000} />);

    const button = screen.getByRole('button');

    // Expand
    await user.click(button);
    expect(screen.getByText('toggle content')).toBeInTheDocument();

    // Collapse
    await user.click(button);
    expect(screen.queryByText('toggle content')).not.toBeInTheDocument();
  });

  it('shows content while isThinking is true (stream is open)', () => {
    // During streaming, content is visible so the user can watch it arrive.
    // The component should not hide content behind a collapsed state mid-stream.
    render(<ThinkingBlock text="live thinking" isThinking={true} durationMs={null} />);
    expect(screen.getByText('live thinking')).toBeInTheDocument();
  });
});
