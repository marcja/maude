/**
 * src/app/__tests__/page.test.tsx
 *
 * Tests for the Welcome page — the app's entry point at `/`.
 * Verifies navigation links and content per SPEC §4.1:
 *   - App name and one-line description
 *   - "Start chatting" button → /chat
 *   - Settings link → /settings
 *   - Visual indication of local/private nature
 */

import { render, screen } from '@testing-library/react';
import WelcomePage from '../page';

// ---------------------------------------------------------------------------
// Suite 1: Content
// ---------------------------------------------------------------------------

describe('WelcomePage — content', () => {
  it('displays "Maude" as the app name on the welcome page', () => {
    render(<WelcomePage />);
    expect(screen.getByText('Maude')).toBeInTheDocument();
  });

  it('displays a description identifying the app as a local AI chat assistant', () => {
    render(<WelcomePage />);
    // The description should convey what Maude is — a local AI chat app
    expect(screen.getByText(/local AI chat assistant/i)).toBeInTheDocument();
  });

  it('indicates the private/local nature of the app', () => {
    render(<WelcomePage />);
    // SPEC §4.1: "Brief visual indication of local/private nature"
    expect(screen.getByText(/no data leaves/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Navigation
// ---------------------------------------------------------------------------

describe('WelcomePage — navigation', () => {
  it('has a "Start chatting" link that navigates to /chat', () => {
    render(<WelcomePage />);
    const link = screen.getByRole('link', { name: /start chatting/i });
    expect(link).toHaveAttribute('href', '/chat');
  });

  it('has a settings link that navigates to /settings', () => {
    render(<WelcomePage />);
    const link = screen.getByRole('link', { name: /settings/i });
    expect(link).toHaveAttribute('href', '/settings');
  });
});
