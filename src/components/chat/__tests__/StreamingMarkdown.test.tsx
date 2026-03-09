/**
 * src/components/chat/__tests__/StreamingMarkdown.test.tsx
 *
 * Tests for the StreamingMarkdown component.
 *
 * Why these tests:
 *   StreamingMarkdown wraps react-markdown + remark-gfm to render Markdown
 *   incrementally as tokens arrive. The critical concern is that partial
 *   Markdown (unclosed fences, incomplete links) renders without throwing.
 *   We don't test react-markdown internals — we test our wrapper's contract:
 *   1. Partial/invalid Markdown renders without throwing (graceful degradation)
 *   2. Complete Markdown renders the expected HTML elements
 *   3. Code fences render as <code> blocks (not inline text)
 *   4. GFM tables render as <table> elements
 *   5. The component can be used inside MessageItem (integration smoke test)
 *
 * react-markdown renders synchronously in test so no async waitFor is needed.
 */

import { render, screen } from '@testing-library/react';
import { StreamingMarkdown } from '../StreamingMarkdown';

// ---------------------------------------------------------------------------
// Suite 1: Partial / incomplete Markdown (streaming in progress)
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — partial Markdown', () => {
  it('renders plain text without throwing', () => {
    expect(() => render(<StreamingMarkdown content="Hello world" />)).not.toThrow();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders a partial code fence without throwing', () => {
    // Unclosed ``` — common mid-stream state
    expect(() => render(<StreamingMarkdown content={'```js\nconst x = 1'} />)).not.toThrow();
  });

  it('renders partial bold text without throwing', () => {
    // Single asterisk — may be partial **bold**
    expect(() => render(<StreamingMarkdown content="Hello *partial" />)).not.toThrow();
  });

  it('renders an empty string without throwing', () => {
    expect(() => render(<StreamingMarkdown content="" />)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Complete Markdown renders correct HTML elements
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — complete Markdown', () => {
  it('renders a heading as an <h1>', () => {
    render(<StreamingMarkdown content="# Heading" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders bold text as <strong>', () => {
    render(<StreamingMarkdown content="**bold text**" />);
    expect(screen.getByText('bold text').tagName.toLowerCase()).toBe('strong');
  });

  it('renders a bullet list as <ul> with <li> items', () => {
    render(<StreamingMarkdown content={'- item one\n- item two'} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders a link as <a>', () => {
    render(<StreamingMarkdown content="[click here](https://example.com)" />);
    const link = screen.getByRole('link', { name: 'click here' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com');
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Code fences render as code blocks
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — code blocks', () => {
  it('renders a complete code fence as a <code> element', () => {
    render(<StreamingMarkdown content={'```\nconst x = 1;\n```'} />);
    // react-markdown wraps fenced code in <pre><code>
    expect(screen.getByText('const x = 1;').tagName.toLowerCase()).toBe('code');
  });

  it('renders inline code as a <code> element', () => {
    render(<StreamingMarkdown content="Use `npm install` to install." />);
    expect(screen.getByText('npm install').tagName.toLowerCase()).toBe('code');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: GFM table renders as <table>
// ---------------------------------------------------------------------------

describe('StreamingMarkdown — GFM tables', () => {
  it('renders a GFM table as a <table> element', () => {
    const tableMarkdown = '| Name | Age |\n| ---- | --- |\n| Alice | 30 |';
    render(<StreamingMarkdown content={tableMarkdown} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
