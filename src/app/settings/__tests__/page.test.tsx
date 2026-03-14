/**
 * src/app/settings/__tests__/page.test.tsx
 *
 * Tests for the Settings page component. Uses fetch mocking (not MSW) because
 * the component runs in jsdom where MSW's service worker is unavailable.
 * The component fetches from /api/settings on mount and POSTs on save.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../page';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

// jsdom does not provide a global fetch, so we install a jest.fn() on
// globalThis and restore the original value (undefined) after each test.
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
// Suite 1: Loading settings from API
// ---------------------------------------------------------------------------

describe('SettingsPage — loading', () => {
  it('fetches settings on mount and populates form fields', async () => {
    fetchMock.mockReturnValueOnce(
      mockFetchResponse({ name: 'Alice', personalizationPrompt: 'Be concise' })
    );

    render(<SettingsPage />);

    // Wait for the fetch to resolve and fields to populate
    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Alice');
    });
    expect(screen.getByLabelText(/personalization/i)).toHaveValue('Be concise');
  });

  it('shows a loading state while fetching', () => {
    // Never-resolving promise to keep the loading state visible
    fetchMock.mockReturnValueOnce(new Promise(() => {}));

    render(<SettingsPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows an error message when fetch fails', async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse({ error: 'Server error' }, 500));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Saving settings
// ---------------------------------------------------------------------------

describe('SettingsPage — saving', () => {
  it('POSTs updated settings and shows success feedback', async () => {
    const user = userEvent.setup();

    // Initial GET
    fetchMock.mockReturnValueOnce(mockFetchResponse({ name: '', personalizationPrompt: '' }));

    render(<SettingsPage />);

    // Wait for form to load
    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('');
    });

    // Fill in fields
    await user.type(screen.getByLabelText(/name/i), 'Bob');
    await user.type(screen.getByLabelText(/personalization/i), 'Be helpful');

    // Mock the POST response
    fetchMock.mockReturnValueOnce(
      mockFetchResponse({ name: 'Bob', personalizationPrompt: 'Be helpful' })
    );

    // Click save
    await user.click(screen.getByRole('button', { name: /save/i }));

    // Verify POST was called with correct body
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', personalizationPrompt: 'Be helpful' }),
    });

    // Success feedback should appear
    await waitFor(() => {
      expect(screen.getByText(/settings saved/i)).toBeInTheDocument();
    });
  });

  it('shows error feedback when save fails', async () => {
    const user = userEvent.setup();

    // Initial GET
    fetchMock.mockReturnValueOnce(mockFetchResponse({ name: 'Alice', personalizationPrompt: '' }));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/name/i)).toHaveValue('Alice');
    });

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

describe('SettingsPage — navigation', () => {
  it('has a link back to the chat page', async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse({ name: '', personalizationPrompt: '' }));

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /chat/i })).toHaveAttribute('href', '/chat');
    });
  });
});
