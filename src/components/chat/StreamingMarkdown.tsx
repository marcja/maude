'use client';

/**
 * src/components/chat/StreamingMarkdown.tsx
 *
 * Renders assistant response content as Markdown during and after streaming.
 * Replaces the plain-text <p> in MessageItem (T07) with rich formatting.
 *
 * Design decisions:
 *
 * react-markdown is tolerant of partial/incomplete Markdown by design: its
 * parser gracefully handles unclosed fences and incomplete markup by treating
 * them as plain text. No try/catch or partial-buffer management is needed —
 * the library handles the streaming incremental-input case correctly.
 *
 * remark-gfm adds GitHub-Flavored Markdown: tables, strikethrough, task
 * lists, and autolinks. This matches the most common assistant output format.
 *
 * Prose classes applied inline via components prop rather than a global
 * stylesheet: keeps the component self-contained and easy to test. The
 * minimal class set (prose-like sizing, code background) avoids a full
 * @tailwindcss/typography dependency.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamingMarkdownProps {
  /** Raw Markdown text, potentially incomplete (partial fences, etc.). */
  content: string;
}

// ---------------------------------------------------------------------------
// Stable plugin array — defined outside the component so it isn't recreated
// on every render, which would cause react-markdown to re-parse unnecessarily.
// ---------------------------------------------------------------------------

const REMARK_PLUGINS = [remarkGfm];

// ---------------------------------------------------------------------------
// Stable component overrides — hoisted to module scope so react-markdown does
// not rebind on every render. During streaming this component re-renders on
// each token (30-50/sec); an inline object would create a new reference each
// time, forcing unnecessary reconciliation work.
// ---------------------------------------------------------------------------

const COMPONENTS = {
  // Headings
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-2 text-xl font-bold">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-2 text-lg font-semibold">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 text-base font-semibold">{children}</h3>
  ),
  // Paragraphs: margin between paragraphs, not after the last one
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  // Code blocks and inline code
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.startsWith('language-');
    return isBlock ? (
      // Block code: pre + code are rendered separately by react-markdown;
      // className carries the language- prefix for the inner <code>.
      <code className="block overflow-x-auto rounded bg-gray-100 px-3 py-2 font-mono text-sm">
        {children}
      </code>
    ) : (
      <code className="rounded bg-gray-100 px-1 font-mono text-sm">{children}</code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="mb-2">{children}</pre>,
  // Lists
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-disc pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-decimal pl-5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
  // Tables (GFM)
  table: ({ children }: { children?: React.ReactNode }) => (
    <table className="mb-2 w-full border-collapse text-sm">{children}</table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-gray-300 bg-gray-50 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-gray-300 px-2 py-1">{children}</td>
  ),
  // Links — open in new tab; rel noopener prevents opener access
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline hover:text-blue-800"
    >
      {children}
    </a>
  ),
  // Blockquotes
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="mb-2 border-l-4 border-gray-300 pl-3 italic text-gray-600">
      {children}
    </blockquote>
  ),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StreamingMarkdown({ content }: StreamingMarkdownProps) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}
