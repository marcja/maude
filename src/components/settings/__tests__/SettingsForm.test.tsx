/**
 * src/components/settings/__tests__/SettingsForm.test.tsx
 *
 * Tests for the SettingsForm client component. Unlike the old page tests,
 * these render SettingsForm directly with prop-based initial data — no
 * mount-time fetch, no loading state, no load error state.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsForm from '../SettingsForm';

// ---------------------------------------------------------------------------
// Fetch mock helpers — only needed for save (POST), not load (GET)
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Suite 1: Rendering with prop-based initial data
// ---------------------------------------------------------------------------

describe('SettingsForm — rendering', () => {
  it('renders with prop-based initial data immediately (no loading state)', () => {
    render(
      <SettingsForm initialSettings={{ name: 'Alice', personalizationPrompt: 'Be concise' }} />
    );

    // Fields populated immediately — no waitFor needed
    expect(screen.getByLabelText(/name/i)).toHaveValue('Alice');
    expect(screen.getByLabelText(/personalization/i)).toHaveValue('Be concise');
  });

  it('has no loading spinner or loading text', () => {
    render(<SettingsForm initialSettings={{ name: '', personalizationPrompt: '' }} />);

    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Saving settings
// ---------------------------------------------------------------------------

describe('SettingsForm — saving', () => {
  it('POSTs updated settings and shows success feedback', async () => {
    const user = userEvent.setup();

    render(<SettingsForm initialSettings={{ name: '', personalizationPrompt: '' }} />);

    // Fields are immediately available — no waitFor
    await user.type(screen.getByLabelText(/name/i), 'Bob');
    await user.type(screen.getByLabelText(/personalization/i), 'Be helpful');

    // Mock the POST response
    fetchMock.mockReturnValueOnce(
      mockFetchResponse({ name: 'Bob', personalizationPrompt: 'Be helpful' })
    );

    await user.click(screen.getByRole('button', { name: /save/i }));

    // useActionState runs the action in a transition — wait for the POST
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bob', personalizationPrompt: 'Be helpful' }),
      });
    });

    // Success feedback should appear
    await waitFor(() => {
      expect(screen.getByText(/settings saved/i)).toBeInTheDocument();
    });

    // Form fields retain saved values after React 19's form reset
    expect(screen.getByLabelText(/name/i)).toHaveValue('Bob');
    expect(screen.getByLabelText(/personalization/i)).toHaveValue('Be helpful');
  });

  it('shows error feedback when save fails', async () => {
    const user = userEvent.setup();

    render(<SettingsForm initialSettings={{ name: 'Alice', personalizationPrompt: '' }} />);

    // Mock a failed POST
    fetchMock.mockReturnValueOnce(mockFetchResponse({ error: 'Validation failed' }, 400));

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Navigation
// ---------------------------------------------------------------------------

describe('SettingsForm — navigation', () => {
  it('has a link back to the chat page', () => {
    render(<SettingsForm initialSettings={{ name: '', personalizationPrompt: '' }} />);

    // Link is immediately available — no waitFor needed
    expect(screen.getByRole('link', { name: /chat/i })).toHaveAttribute('href', '/chat');
  });
});
