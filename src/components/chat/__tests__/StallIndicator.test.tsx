/**
 * src/components/chat/__tests__/StallIndicator.test.tsx
 *
 * Tests for the StallIndicator component.
 * StallIndicator is a pure presentational component — no hooks, no fetch —
 * so the default jsdom environment is sufficient.
 *
 * Behavior under test:
 *   - Renders nothing when not stalled
 *   - Shows "Still working…" text when stalled
 *   - Shows Cancel button when stalled
 *   - Cancel button fires onCancel callback
 *   - Has role="status" for accessibility (live region)
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StallIndicator } from '../StallIndicator';

// ---------------------------------------------------------------------------
// Suite 1: hidden state — not stalled
// ---------------------------------------------------------------------------

describe('StallIndicator — hidden state', () => {
  it('renders nothing when isStalled is false', () => {
    const { container } = render(<StallIndicator isStalled={false} onCancel={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: visible state — stalled
// ---------------------------------------------------------------------------

describe('StallIndicator — stalled state', () => {
  it('renders "Still working…" text when isStalled is true', () => {
    render(<StallIndicator isStalled={true} onCancel={jest.fn()} />);
    expect(screen.getByText(/Still working…/)).toBeInTheDocument();
  });

  it('renders a Cancel button when stalled', () => {
    render(<StallIndicator isStalled={true} onCancel={jest.fn()} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('has role="status" for accessibility', () => {
    render(<StallIndicator isStalled={true} onCancel={jest.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Cancel interaction
// ---------------------------------------------------------------------------

describe('StallIndicator — Cancel button', () => {
  it('calls onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const handleCancel = jest.fn();

    render(<StallIndicator isStalled={true} onCancel={handleCancel} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(handleCancel).toHaveBeenCalledTimes(1);
  });
});
