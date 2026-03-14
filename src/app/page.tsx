/**
 * src/app/page.tsx
 *
 * Welcome page — the app's entry point at `/`. Intentionally simple per
 * SPEC §4.1: app name, one-line description, "Start chatting" call-to-action,
 * and a brief indication that everything runs local.
 *
 * No functional complexity. No data fetching. Just static content with
 * navigation links to /chat and /settings.
 */

import Link from 'next/link';

export default function WelcomePage() {
  return (
    <main className="flex h-screen flex-col items-center justify-center px-4">
      <h1 className="text-4xl font-light tracking-tight text-content">Maude</h1>
      <p className="mt-3 text-lg text-content-muted">Your local AI chat assistant</p>
      <p className="mt-2 text-sm text-content-faint">
        Runs entirely on your machine — no data leaves your computer.
      </p>

      <Link
        href="/chat"
        className="mt-8 rounded-xl bg-accent/90 px-6 py-3 text-sm font-medium text-surface transition-all hover:bg-accent"
      >
        Start chatting
      </Link>

      <ul className="mt-6 space-y-1 text-sm text-content-faint">
        <li>Powered by Ollama</li>
        <li>Conversations stored locally</li>
        <li>Full observability</li>
      </ul>

      <Link
        href="/settings"
        className="mt-4 text-sm text-content-muted transition-colors hover:text-content"
      >
        Settings
      </Link>
    </main>
  );
}
