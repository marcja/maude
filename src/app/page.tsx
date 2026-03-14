/**
 * src/app/page.tsx
 *
 * Welcome page — the app's entry point at `/`. Intentionally simple per
 * SPEC §4.1: app name, one-line description, "Start chatting" call-to-action,
 * and a brief indication that everything runs locally.
 *
 * No functional complexity. No data fetching. Just static content with
 * navigation links to /chat and /settings.
 */

import Link from 'next/link';

export default function WelcomePage() {
  return (
    <main className="flex h-screen flex-col items-center justify-center px-4">
      <h1 className="text-4xl font-bold text-gray-900">Maude</h1>
      <p className="mt-3 text-lg text-gray-600">Your local AI chat assistant</p>
      <p className="mt-2 text-sm text-gray-400">
        Runs entirely on your machine — no data leaves your computer.
      </p>

      <Link
        href="/chat"
        className="mt-8 rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
      >
        Start chatting
      </Link>

      <Link
        href="/settings"
        className="mt-4 text-sm text-blue-600 hover:text-blue-700 hover:underline"
      >
        Settings
      </Link>
    </main>
  );
}
