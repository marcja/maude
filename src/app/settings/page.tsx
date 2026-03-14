'use client';

/**
 * src/app/settings/page.tsx
 *
 * Settings page — allows the user to set their name and personalization
 * prompt. These values are used by promptBuilder to customize the system
 * prompt sent to the model on every chat request.
 *
 * Design decisions:
 *
 * Fetch on mount, full replacement on save:
 *   GET /api/settings loads current values into controlled inputs. POST
 *   /api/settings sends both fields on every save — a full replacement,
 *   not a partial patch. This keeps the API contract simple and avoids
 *   merge conflicts between stale client state and server state.
 *
 * Success feedback with auto-dismiss:
 *   A "Settings saved" banner appears after successful save and auto-
 *   dismisses after 3 seconds. This gives clear confirmation without
 *   requiring user interaction to clear it.
 *
 * Error handling at both load and save boundaries:
 *   Load errors show a persistent alert (user can't interact until
 *   settings are known). Save errors show a dismissible alert that
 *   doesn't clear the form — the user can fix and retry.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Settings {
  name: string;
  personalizationPrompt: string;
}

type Status = 'idle' | 'loading' | 'saving' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [name, setName] = useState('');
  const [personalizationPrompt, setPersonalizationPrompt] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch current settings on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) {
          throw new Error('Failed to load settings');
        }
        const data: Settings = await res.json();
        if (cancelled) return;
        setName(data.name);
        setPersonalizationPrompt(data.personalizationPrompt);
        setStatus('idle');
      } catch {
        if (cancelled) return;
        setErrorMessage('Failed to load settings');
        setStatus('error');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-dismiss success feedback after 3 seconds
  useEffect(() => {
    if (status !== 'success') return;
    const timer = setTimeout(() => setStatus('idle'), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    setErrorMessage('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, personalizationPrompt }),
      });

      if (!res.ok) {
        throw new Error('Failed to save settings');
      }

      setStatus('success');
    } catch {
      setErrorMessage('Failed to save settings');
      setStatus('error');
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-500">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <Link href="/chat" className="text-sm text-blue-600 hover:text-blue-700 hover:underline">
          Back to chat
        </Link>
      </div>

      {status === 'success' && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Settings saved
        </div>
      )}

      {status === 'error' && (
        <div
          className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        <div>
          <label htmlFor="settings-name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="settings-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (used in the system prompt)"
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="settings-prompt" className="block text-sm font-medium text-gray-700 mb-1">
            Personalization prompt
          </label>
          <textarea
            id="settings-prompt"
            value={personalizationPrompt}
            onChange={(e) => setPersonalizationPrompt(e.target.value)}
            placeholder="Additional instructions for the assistant (e.g. &quot;Be concise&quot;)"
            rows={4}
            className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={status === 'saving'}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
