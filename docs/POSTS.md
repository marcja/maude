# Writing Phase Posts for Maude

Instructions for Claude when writing `docs/PHASE<N>.md` blog posts.

---

## Purpose

Each phase post is a standalone tutorial that teaches an experienced engineer how
a specific phase of the Maude project was built and why. The reader should come
away understanding the key design decisions, the interesting code patterns, and
how the pieces connect — without needing to read SPEC.md, CLAUDE.md, or the
source code directly.

---

## Audience

An experienced software engineer who is generally skilled but may be unfamiliar
with the specific technologies in this project (React, Next.js, SSE, MSW,
Tailwind, better-sqlite3, Biome, etc.). Do not explain what a database or a
component is. Do explain why `better-sqlite3` uses a synchronous API, or why
`startTransition` wraps token accumulation but not the `isStreaming` flag.

---

## Tone

- Informal, expert-to-expert. Think "here's why we did it this way" — not
  "here's what a function is."
- No filler. Every sentence should teach something or move the narrative forward.
- Confident but not arrogant. Present decisions as reasoned trade-offs, not
  self-evident truths.
- Use "we" or direct address ("you") freely. Avoid passive voice when active
  voice is clearer.
- No emojis. No exclamation marks (except in code/UI strings).

---

## Length

Target 4,000+ words per post (~25 minute read). This is a deep tutorial, not a
changelog summary. But length should come from depth of explanation, not padding.
If a section is naturally short (e.g., the prompt builder), keep it short and
move on.

---

## Structure conventions

Every post follows this general arc:

### 1. Opening (1-3 paragraphs)

State the goal of this phase in concrete terms — what you can do after this
phase that you couldn't before. Be specific: "you can type a message and watch
tokens stream in" not "the streaming infrastructure is in place."

Mention what's deliberately *not* included in this phase.

If relevant, state the scope in quantitative terms (N tasks, N commits, ~N lines
of code).

### 2. Body (majority of the post)

Walk through the implementation in the order that best teaches the concepts.
This is usually bottom-up (dependencies before dependents), but use whatever
order makes the narrative clearest.

For each major module or concern:

- **Explain the problem it solves** before showing the solution. "The browser
  could call Ollama directly — so why don't we?" before describing the BFF.
- **Show a trimmed code excerpt** (5-15 lines) that illustrates the key pattern.
  Use `// ...` to elide uninteresting parts. Never paste an entire file.
- **Explain the non-obvious design decisions.** Why a ref instead of state? Why
  synchronous instead of async? Why skip DB persistence on abort? These "why"
  explanations are the core value of the post.
- **Connect to the bigger picture.** How does this module relate to what came
  before and what comes after?

### 3. Testing section

Describe the testing strategy for this phase. How are the new modules tested?
What MSW handlers were created and why? Any interesting test infrastructure
(custom Jest environments, Playwright fixtures, etc.)?

### 4. "Where we ended up" section

Two lists:

- **What works**: bullet list of capabilities now available.
- **What's deliberately missing**: bullet list of planned features not yet
  implemented, with one-line explanation of which future phase adds them.

This section should make clear that the missing features are *planned*, not
*forgotten* — and that the architecture is ready for them.

### 5. "What's next" section (1-2 paragraphs)

Brief preview of the next phase. Link to `./PHASE<N+1>.md`. Describe what the
next phase adds in terms of user-visible capabilities, not task IDs.

---

## Code snippets

- **Trimmed excerpts only.** Show the 5-15 lines that illustrate the pattern.
  Use `// ...` for elided code. Never paste an entire file.
- **Use real code from the project**, not pseudocode. The snippet should match
  the actual source at the time the post is written.
- **TypeScript syntax highlighting** (` ```typescript `) for `.ts`/`.tsx` files.
  Use ` ```sql ` for SQL, ` ```bash ` for shell commands, ` ```tsx ` when JSX
  is prominent.
- **Include comments from the source** when they explain *why* — these are part
  of the teaching. Strip comments that only describe *what*.
- Introduce each snippet with a sentence explaining what the reader is about to
  see. Don't drop code blocks without context.

---

## Diagrams

Use ASCII box diagrams for architecture and data flow. Match the style from
PHASE0.md (the streaming pipeline diagram and three-column layout). Keep them
simple — they're orientation aids, not UML.

---

## Formatting

- Use `---` horizontal rules to separate major sections.
- H2 (`##`) for major sections, H3 (`###`) for subsections, H4 (`####`) for
  sub-subsections (use sparingly — prefer H3).
- Bold (`**...**`) for key terms on first use and for list item labels.
- Inline code (`` `...` ``) for file paths, function names, type names, CLI
  commands, and short code references.
- Longer code blocks with language-tagged fences.
- No table of contents — the post should flow as a narrative.

---

## Cross-references

- Link to adjacent phase posts with relative paths: `[Phase 1](./PHASE1.md)`.
- Reference source files by path: `` `src/hooks/useStream.ts` ``.
- Reference tasks by ID when it helps orient the reader: "The model adapter
  (T02)" — but don't let task IDs dominate the prose. The post teaches concepts,
  not project management.
- Do not link to SPEC.md, CLAUDE.md, or TASKS.md — the post should be
  self-contained.

---

## What to emphasize

These are the things that make the posts valuable. Prioritize them:

1. **"Why" explanations for non-obvious decisions.** Why a ref not state? Why
   synchronous SQLite? Why persist on completion but not on abort? Why
   `startTransition` here but not there? These are the moments where the reader
   learns something they couldn't get from reading the code alone.

2. **Patterns that repeat across the codebase.** The buffer-and-split SSE
   parsing pattern appears in both `modelAdapter.ts` and `sseParser.ts`. Call
   this out — it teaches a transferable technique.

3. **How modules connect.** The SSE parser yields typed events → the hook
   consumes them with a switch → the components render based on hook state. Trace
   the data flow through the system.

4. **What would go wrong without a specific design choice.** "Without
   `startTransition`, the Stop button has a noticeable delay during fast
   streaming." Concrete failure modes are more convincing than abstract
   principles.

5. **Framework-specific patterns the reader might not know.** React's automatic
   batching, `useDeferredValue` for expensive re-parses, MSW's dual-layer
   architecture (setupServer vs setupWorker). Explain these in the context where
   they're used, not as abstract tutorials.

---

## What to avoid

- **Changelog style.** Don't list every file that changed. Focus on concepts
  and decisions, not deliverables.
- **Spec regurgitation.** Don't repeat the SPEC.md text. The post explains *how*
  and *why* things were built, not *what* was specified.
- **Over-qualifying.** Don't say "this is a simple function" or "this is a
  complex component." Just explain what it does and why.
- **Future speculation.** Mention what's planned next at a high level ("Phase 3
  adds the observability pane"), but don't speculate on implementation details
  of future phases.
- **Apologizing for simplicity.** If the prompt builder is five lines of code,
  that's fine. Say "this one is simple and that's the point" and move on.

---

## Pre-writing checklist

Before writing a phase post:

1. Read TASKS.md to identify which tasks belong to this phase and their
   dependency order.
2. Read the git log for this phase's commits (`git log --oneline`) to understand
   the actual build sequence.
3. Read the source files for every module created or modified in this phase.
   Note the doc comments — they often contain the "why" explanations you'll
   want to surface in the post.
4. Read the test files to understand what scenarios are covered and what MSW
   handlers were created.
5. Read the previous phase post to understand what the reader already knows.
   Don't re-explain concepts covered in earlier posts (e.g., don't re-explain
   the BFF pattern in Phase 2 if Phase 1 already covered it).

---

## Example section (from PHASE1.md)

Here's a representative section that demonstrates the right level of depth,
code inclusion, and "why" explanation:

> ### The model adapter: one file, one backend (T02)
>
> `src/lib/server/modelAdapter.ts` is the only file in the project that knows
> Ollama exists. It reads two environment variables — `OLLAMA_BASE_URL` and
> `MODEL_NAME` — and exports a single function:
>
> ```typescript
> export async function streamCompletion(
>   messages: ChatMessage[],
>   systemPrompt: string,
>   signal: AbortSignal
> ): Promise<AsyncIterable<string>>
> ```
>
> You hand it a conversation and a system prompt, and you get back an async
> iterable of raw token strings. The caller drives consumption with
> `for await...of`. The adapter handles connection failures by throwing a typed
> `ModelAdapterError` with a code (`'model_unreachable'` or `'bad_response'`)
> so the BFF can map errors to specific UI messages instead of showing a
> generic "something went wrong."
>
> Under the hood, the adapter contains a private `tokenStream` generator that
> reads Ollama's OpenAI-compatible SSE format:
>
> ```typescript
> async function* tokenStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
>   const reader = body.getReader();
>   const decoder = new TextDecoder();
>   let buffer = '';
>
>   try {
>     while (true) {
>       const { done, value } = await reader.read();
>       if (done) break;
>
>       buffer += decoder.decode(value, { stream: true });
>       const lines = buffer.split('\n');
>       buffer = lines.pop() ?? '';
>
>       for (const line of lines) {
>         // ... parse data: lines, extract content, yield tokens
>       }
>     }
>   } finally {
>     reader.releaseLock();
>   }
> }
> ```
>
> This pattern — buffer incoming bytes, split on newlines, keep the last
> incomplete line for the next chunk — appears in two places in the codebase
> (here and in the client-side SSE parser). It's the fundamental technique for
> reading a streaming text protocol from a `ReadableStream`.

Notice: problem stated first, code shown second, design decisions explained
third, connection to bigger picture fourth.
