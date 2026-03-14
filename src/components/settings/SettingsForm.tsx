'use client';

/**
 * src/components/settings/SettingsForm.tsx
 *
 * Client component for the settings form. Receives initial settings as props
 * from the server component parent (no mount-time fetch). Handles save via
 * useActionState, success auto-dismiss, and error display.
 */

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';

import type { Settings } from '../../lib/shared/types';

interface SaveResult {
  status: 'idle' | 'success' | 'error';
  errorMessage: string;
}

interface SettingsFormProps {
  initialSettings: Settings;
}

export default function SettingsForm({ initialSettings }: SettingsFormProps) {
  // Track the current default values — updated after save so React 19's
  // form reset reflects the saved values, not the original prop values.
  const [currentDefaults, setCurrentDefaults] = useState(initialSettings);

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

        // Update defaults so React 19 form reset uses saved values
        setCurrentDefaults({ name, personalizationPrompt });

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
  useEffect(() => {
    if (saveResult.status === 'success') {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
    setShowSuccess(false);
  }, [saveResult]);

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
            defaultValue={currentDefaults.name}
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
            defaultValue={currentDefaults.personalizationPrompt}
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
