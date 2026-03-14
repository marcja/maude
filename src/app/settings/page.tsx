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
 *   GET /api/settings loads current values on mount. POST /api/settings
 *   sends both fields on every save — a full replacement, not a partial
 *   patch. This keeps the API contract simple and avoids merge conflicts
 *   between stale client state and server state.
 *
 * useActionState for save:
 *   The save flow uses React 19's useActionState to manage the async
 *   action + pending/result state in one primitive. The form uses the
 *   `action` prop (not `onSubmit`) and inputs are uncontrolled with
 *   `name` attributes, extracting values from FormData.
 *
 * Mount-time fetch remains a useEffect:
 *   Cannot use `use()` to suspend because this is a 'use client' page
 *   with no server component providing the promise.
 *
 * Success feedback with auto-dismiss:
 *   A "Settings saved" banner appears after successful save and auto-
 *   dismisses after 3 seconds via a separate boolean state, since
 *   useActionState's state can only be updated by running the action.
 *
 * Error handling at both load and save boundaries:
 *   Load errors show a persistent alert (user can't interact until
 *   settings are known). Save errors show a dismissible alert that
 *   doesn't clear the form — the user can fix and retry.
 */

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Settings {
  name: string;
  personalizationPrompt: string;
}

interface SaveResult {
  status: 'idle' | 'success' | 'error';
  errorMessage: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  // Mount-time fetch state — separate from the save action state because
  // loading happens once on mount, not via a form action.
  const [loadedSettings, setLoadedSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Save action via useActionState — replaces manual handleSave + status/errorMessage state.
  // isPending is true while the action is executing (replaces status === 'saving').
  const [saveResult, saveAction, isSaving] = useActionState(
    async (_prevState: SaveResult, formData: FormData): Promise<SaveResult> => {
      const name = String(formData.get('name') ?? '');
      const personalizationPrompt = String(formData.get('personalizationPrompt') ?? '');

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, personalizationPrompt }),
        });

        if (!res.ok) {
          throw new Error('Failed to save settings');
        }

        return { status: 'success', errorMessage: '' };
      } catch {
        return { status: 'error', errorMessage: 'Failed to save settings' };
      }
    },
    { status: 'idle', errorMessage: '' } satisfies SaveResult
  );

  // Track success banner visibility separately — useActionState's state can
  // only be updated by running the action, so auto-dismiss needs its own state.
  const [showSuccess, setShowSuccess] = useState(false);

  // Show success banner when save succeeds; auto-dismiss after 3 seconds.
  // React bails out of re-render when setShowSuccess receives the same value,
  // so the false→false path in the else branch is a no-op at the DOM level.
  useEffect(() => {
    if (saveResult.status === 'success') {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
    setShowSuccess(false);
  }, [saveResult]);

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
        setLoadedSettings(data);
      } catch {
        if (cancelled) return;
        setLoadError('Failed to load settings');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!loadedSettings && !loadError) {
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

      {showSuccess && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Settings saved
        </div>
      )}

      {loadError && (
        <div
          className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600"
          role="alert"
        >
          {loadError}
        </div>
      )}

      {saveResult.status === 'error' && (
        <div
          className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600"
          role="alert"
        >
          {saveResult.errorMessage}
        </div>
      )}

      <form action={saveAction} className="space-y-5">
        <div>
          <label htmlFor="settings-name" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="settings-name"
            name="name"
            type="text"
            defaultValue={loadedSettings?.name ?? ''}
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
            name="personalizationPrompt"
            defaultValue={loadedSettings?.personalizationPrompt ?? ''}
            placeholder="Additional instructions for the assistant (e.g. &quot;Be concise&quot;)"
            rows={4}
            className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
