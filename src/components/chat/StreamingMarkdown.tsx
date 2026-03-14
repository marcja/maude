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
  // Headings — clear visual hierarchy above 15px body text.
  // Large mt creates section breaks; first:mt-0 avoids a gap at the top.
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mt-8 mb-3 text-xl font-bold text-content first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mt-7 mb-2 text-lg font-semibold text-content first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mt-5 mb-1.5 text-base font-semibold text-content first:mt-0">{children}</h3>
  ),
  // Paragraphs: generous spacing (~1.3em at 15px body)
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-5 last:mb-0">{children}</p>,
  // Code blocks and inline code
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.startsWith('language-');
    return isBlock ? (
      // Block code: pre + code are rendered separately by react-markdown;
      // className carries the language- prefix for the inner <code>.
      <code className="block overflow-x-auto rounded-lg bg-surface-dim px-4 py-3 font-mono text-sm leading-relaxed text-content-muted">
        {children}
      </code>
    ) : (
      <code className="rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-sm text-accent">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <pre className="mb-5">{children}</pre>,
  // Lists — block-level margin matches paragraphs; items are tight within
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-5 list-disc pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-5 list-decimal pl-5">{children}</ol>
  ),
  // [&>p]:mb-0 strips paragraph margins inside loose list items (Markdown
  // wraps items separated by blank lines in <p> tags).
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="mb-1.5 [&>p]:mb-0">{children}</li>
  ),
  // Tables (GFM)
  table: ({ children }: { children?: React.ReactNode }) => (
    <table className="mb-5 w-full border-collapse text-sm">{children}</table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-edge bg-surface-raised px-3 py-1.5 text-left font-semibold text-content">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-edge px-3 py-1.5">{children}</td>
  ),
  // Links — open in new tab; rel noopener prevents opener access
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline hover:text-accent-hover"
    >
      {children}
    </a>
  ),
  // [&>p]:mb-0 prevents double-spacing inside blockquotes from nested <p> margins
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-5 border-l-4 border-edge pl-4 italic text-content-muted [&>p]:mb-0">
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
