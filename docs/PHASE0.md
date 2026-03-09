# Phase 0: Setting the Stage

## What is Maude, and why does it exist?

Maude — "Marc's Claude" — is a chat application that streams responses from a local LLM. You've seen apps like this before: you type a message, tokens appear one by one, you can cancel mid-stream. ChatGPT, Claude, and dozens of open-source wrappers do the same thing.

So why build another one?

Because most of those apps are optimized for *using* — not for *understanding*. Maude is optimized for the opposite. It's a teaching instrument. Every architectural decision exists to make a specific frontend engineering concern visible, testable, and exercisable. When there's a choice between "clever and compact" and "explicit and inspectable," Maude chooses the latter.

In practice, "pedagogical" means a few concrete things:

- **Comments explain *why*, not *what*.** You won't find `// increment counter` above `counter++`. You will find a paragraph explaining why an `AbortController` is stored in a ref instead of state, or why `startTransition` wraps token accumulation but not the `isStreaming` flag.

- **Each module has a single, clear responsibility.** The model adapter talks to Ollama. The SSE parser reads bytes. The BFF route translates between formats. There are no "utils" files with twelve unrelated functions.

- **The test infrastructure is a first-class deliverable.** MSW handlers, custom Jest environments, Playwright fixtures — these aren't afterthoughts bolted on after the feature works. They're built in the same commit as the feature they test, often written first.

- **Observability is baked into the architecture.** A dedicated debug pane will show live metrics (time-to-first-token, throughput), an event log, and the exact system prompt sent to the model. You can watch the streaming pipeline work, not just see the output.

If you want to follow along, the entire codebase is in the repository. Each phase corresponds to a sequence of commits, and each commit builds on the last. The git history is designed to be read in order — each commit message explains what was built, why, and what comes next.

This post covers Phase 0: everything that happens before the first line of feature code is written. If you're the kind of engineer who skips to the interesting parts, feel free to jump ahead to [Phase 1](./PHASE1.md). But if you've ever inherited a project where the linter was "we'll add it later" and the tests were "run them manually sometimes," you might find that the foundation is the interesting part.

---

## The architecture you're building toward

Before we dive into tooling and enforcement, let's look at the complete picture. Here's what Maude will look like when all four phases are done:

### The UI: three-column layout

```
┌─────────────┬──────────────────────────────────┬─────────────────┐
│  History     │        Chat Content              │  Observability  │
│  Pane (L)    │                                  │  Pane (R)       │
│  [toggle]    │  Message list                    │  [toggle]       │
│              │  ──────────────────────          │                 │
│  Conv list   │  Input area + controls           │  Metrics tab    │
│              │                                  │  Events tab     │
│              │                                  │  Prompt tab     │
└─────────────┴──────────────────────────────────┴─────────────────┘
```

The left pane lists conversation history. The center is the chat itself — messages scroll up, the input area sits at the bottom. The right pane is the observability panel: live metrics cards, an event log, and a tab that shows the exact system prompt the model received. Both side panes collapse independently.

This isn't the layout we'll build in Phase 1. Phase 1 is a single-column chat — no history, no debug pane. But knowing the destination helps you understand why certain abstractions exist from the start.

### The streaming pipeline

The data flow from keystroke to rendered token looks like this:

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│                                                         │
│  React Components ──► useStream hook ──► sseParser      │
│  (InputArea,          (fetch, abort,    (ReadableStream  │
│   MessageList,         state machine)    → SSEEvent[])   │
│   MessageItem)                                          │
└────────────────────────────┬────────────────────────────┘
                             │ POST /api/chat (SSE)
┌────────────────────────────▼────────────────────────────┐
│  BFF Route (src/app/api/chat/route.ts)                  │
│                                                         │
│  • Reads user settings from SQLite                      │
│  • Composes system prompt via promptBuilder              │
│  • Streams tokens from Ollama via modelAdapter           │
│  • Translates Ollama format → Anthropic-style SSE events │
│  • Persists conversation + messages on completion        │
│  • Propagates abort signal to cancel upstream fetch      │
└────────────────────────────┬────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│  Server layer (src/lib/server/)                         │
│                                                         │
│  modelAdapter.ts  — Ollama streaming (only file that    │
│                     reads OLLAMA_BASE_URL / MODEL_NAME) │
│  promptBuilder.ts — system prompt composition           │
│  db.ts            — SQLite prepared statements          │
└─────────────────────────────────────────────────────────┘
```

Three things to notice:

1. **The client never talks to Ollama.** Everything goes through a Backend-for-Frontend (BFF) route at `/api/chat`. This lets us translate the model's response format, inject settings, persist messages, and propagate cancellation — all on the server side, invisible to the browser.

2. **The BFF translates between wire formats.** Ollama speaks OpenAI-compatible streaming (`data: {"choices":[{"delta":{"content":"hello"}}]}`). The client speaks an Anthropic-style event protocol (`data: {"type":"content_block_delta","delta":{"text":"hello"}}`). The BFF sits in between and translates. The client code has no idea that Ollama is the backend.

3. **There's a strict client/server boundary.** Code under `src/lib/server/` can never be imported by client components. This isn't a convention — it's enforced by the build system and pre-commit checks. The SSE parser lives in `src/lib/client/` because it runs in the browser. The model adapter lives in `src/lib/server/` because it talks to Ollama. They never cross.

### The SSE event protocol

The wire format between BFF and browser deserves its own callout because it drives the entire client-side architecture. Every SSE event is a JSON object with a `type` field:

```
data: {"type": "message_start", "message_id": "uuid", "prompt_used": "..."}
data: {"type": "content_block_start"}
data: {"type": "content_block_delta", "delta": {"text": "Hello"}}
data: {"type": "content_block_delta", "delta": {"text": " world"}}
data: {"type": "content_block_stop"}
data: {"type": "message_stop", "usage": {"input_tokens": 42, "output_tokens": 17}}
```

In TypeScript, `SSEEvent` is a discriminated union — each event type has its own shape, and a `switch` on `event.type` gives you exhaustive type checking. The parser yields these. The hook consumes them. Components render based on them. One type flows through the whole pipeline.

This protocol also includes `thinking_block_start/delta/stop` events for models that emit reasoning traces (like DeepSeek-R1), and `error` events with typed error codes. Those aren't wired up in Phase 1, but the protocol is ready for them.

### The milestone roadmap

The project builds in four phases, each delivering a demoable milestone:

| Milestone | What you can demo |
|---|---|
| **M0: Dev ready** (Phase 0) | Container starts, tooling works, hooks enforced |
| **M1: Minimal viable chat** (Phase 1) | Type a message, see a streaming response |
| **M2: Streaming polish** (Phase 2) | Thinking blocks, rich markdown, stall detection |
| **M3: Observability** (Phase 3) | Debug pane with live metrics, events, system prompt |
| **M4: Full app** (Phase 4) | History, settings, welcome page, three-column layout |

Each phase is a complete, working increment. After Phase 1, you have a chat app that streams. It's ugly and missing features, but it works end to end. After Phase 2, streaming is battle-hardened — it handles thinking traces, markdown rendering, 8-second stalls, and midstream errors. And so on.

---

## Tech stack choices

Here's what Maude uses and — more importantly — *why*:

| Layer | Choice | Why this, not that |
|---|---|---|
| **Framework** | Next.js (App Router) | Provides the BFF route (`/api/chat`) and the React server/client boundary out of the box. The App Router's file-based routing keeps the project simple. |
| **Language** | TypeScript (strict mode) | `strict: true` in tsconfig. No `any` types permitted. No `as` casts without an explanatory comment. This is a teaching codebase — the type system is documentation. |
| **UI** | React 19 | Concurrent features (`startTransition`, `useDeferredValue`) are pedagogically interesting and practically useful for streaming UI. Automatic batching (introduced in React 18, carried forward in 19) simplifies state management in async contexts. React 19 adds `use()` for promise unwrapping, `useActionState` for form handling, and `useOptimistic` for optimistic UI updates — all relevant to later phases. |
| **Styling** | Tailwind CSS | Utility classes keep styling co-located with markup. No separate CSS files to hunt through, no naming conventions to learn. |
| **Database** | SQLite via better-sqlite3 | Synchronous API, zero config, no server process. `better-sqlite3` is faster than async alternatives for a local file database because it avoids the overhead of the Node.js async I/O layer for what are essentially instant disk reads. No ORM — just prepared statements. |
| **LLM Backend** | Ollama | Runs locally on the host machine, exposes an OpenAI-compatible API. No API keys, no cloud dependency, no cost per token. Models run on your own hardware. |
| **Linting + Formatting** | Biome | Single tool replacing both ESLint and Prettier. One config file, ~20x faster execution. Less config surface means fewer "my linter and formatter disagree" problems. |
| **Package Manager** | pnpm | Stricter dependency resolution than npm (no phantom dependencies), faster installs, disk-efficient via content-addressable storage. |
| **Mock Layer** | MSW 2.0 | Intercepts `fetch()` at the network boundary — not the module level. Tests exercise real fetch calls, real `ReadableStream` parsing, real SSE event handling. The only thing that's fake is the server on the other end. |
| **Unit Tests** | Jest + React Testing Library | Jest for the test runner, RTL for testing React components by their behavior (what the user sees), not their implementation (internal state). |
| **E2E Tests** | Playwright | Real browser, real rendering, real scroll events. MSW runs *in the browser* via `setupWorker` for E2E tests — same mock infrastructure, different execution context. |

A few of these choices are worth expanding on.

### Why MSW instead of mocking fetch?

The typical approach to testing code that calls `fetch` is to mock the `fetch` function: `jest.spyOn(global, 'fetch').mockResolvedValue(...)`. This works, but it bypasses everything between your code and the server: request serialization, header handling, response stream construction, `ReadableStream` behavior.

MSW takes a different approach. It installs a service worker (in the browser) or patches the request pipeline (in Node.js) so that your code makes a *real* `fetch` call. The request travels through the normal browser/Node machinery. MSW intercepts it at the network boundary and returns a response. Your `ReadableStream` parsing code, your `TextDecoder`, your chunk buffering — all of that runs for real.

For a streaming chat app, this matters enormously. The SSE parser needs to handle chunks that split across event boundaries. The `useStream` hook needs to handle `AbortError` from a cancelled fetch. These behaviors are invisible to a `jest.fn()` mock but fully exercised with MSW.

MSW also works at two levels. In Jest unit tests, `setupServer` patches Node's request handling — no browser needed. In Playwright E2E tests, `setupWorker` registers a Service Worker in the real browser. Same handler code, same mock responses, but the E2E tests exercise the real DOM, real scroll events, and real browser fetch behavior. This dual-layer approach means you can test your SSE parser in isolation (fast, in Node.js) and then verify it works in the real browser (slower, but catches things like Service Worker registration timing and `ReadableStream` polyfill differences).

### Why Biome instead of ESLint + Prettier?

ESLint and Prettier are the industry standard, but using them together requires careful configuration to avoid conflicts (formatting rules in ESLint that disagree with Prettier, the `eslint-config-prettier` compatibility layer, etc.). Biome replaces both with a single binary that handles linting and formatting. One config file (`biome.json`), one command (`pnpm lint`), no compatibility issues. It's also about 20x faster, which matters when it runs on every commit.

### Why better-sqlite3 instead of an async database driver?

This surprises people who are used to the Node.js "everything must be async" convention. The reasoning: SQLite is an embedded database. It reads from a local file. Those reads complete in microseconds. Wrapping them in `async`/`await` adds overhead (microtask scheduling, promise allocation) for no benefit — there's no I/O wait to yield during. `better-sqlite3` uses the synchronous N-API binding, which is both simpler to use and measurably faster for local file operations. No connection pools, no async wrappers, no `await` on every query.

---

## What Phase 0 delivered

Phase 0 is one task — T00 — and it produces zero features. No routes, no components, no database queries. What it delivers is the *infrastructure that makes everything else possible*.

This might seem like over-engineering for a side project. It's not. The reason most side projects stall isn't a lack of ideas — it's a lack of confidence. You write some code, it works, you write more code, something breaks, you're not sure what, you don't have tests, the linter is off, and now you're debugging instead of building. Phase 0 exists so that every subsequent phase starts from a position of confidence: the code is type-checked, lint-clean, tested, and you know exactly what state the project is in.

### The dev container

Maude runs in a VS Code Dev Container — a Docker container with Node.js, SQLite, and all project tooling pre-installed. The workspace is volume-mounted from the host, so Claude Code (running natively on the Mac) and VS Code (running inside the container) edit the same files.

```
Mac Host
├── Claude Code CLI          ← runs here, edits local files directly
├── VSCode                   ← editor, connects INTO the dev container
│   └── Dev Container ──────────────────────────────────┐
│                            Docker Container            │
│                            ├── Node LTS runtime        │
│                            ├── Next.js dev server      │
│                            ├── better-sqlite3          │
│                            └── /workspace → mounted    │
└── Ollama                   ← runs natively on Mac host
    └── accessible from container via host.docker.internal:11434
```

Ollama runs natively on the Mac (for GPU access) and is reachable from inside the container via `host.docker.internal`. The dev container's `postCreateCommand` runs `pnpm install`, installs git hooks, and sets up Playwright browsers — so opening the project in VS Code gives you a fully working environment with no manual setup.

### The project skeleton

The skeleton includes `package.json` with all dependencies declared, `tsconfig.json` with strict mode enabled, `biome.json` with the linting rules, and an empty `src/` directory structure that mirrors the final architecture. The type checker, linter, and test runner all pass on the empty project — they're green *before* any feature code exists.

This is deliberate. You want your quality gates working and verified before you start writing the code they'll check. If you add the linter after 2,000 lines of code, you'll spend a day fixing 300 lint errors and resent the linter forever. If you add it on day one, every line you write is lint-clean from the start.

The `tsconfig.json` has `strict: true`, which enables TypeScript's full set of type-checking flags: `strictNullChecks` (no implicit `null`/`undefined`), `noImplicitAny` (every variable must have a known type), `strictFunctionTypes` (function parameter types checked contravariantly), and several others. Combined with the project rule of no `any` types and no unexplained `as` casts, this means the type system serves as living documentation. If a function accepts `string | null`, you know the `null` case is real and handled. If it accepts `string`, you know someone upstream already validated it.

### The `biome.json` configuration

Biome's configuration is minimal by design. The project uses 100-character line width (wider than Prettier's default 80, narrower than "no limit"), tabs for indentation, and double quotes for strings. The linting rules are Biome's recommended set with no overrides — the goal is to accept the tool's opinions rather than bikeshedding over individual rules. One setting worth calling out: `useExhaustiveDependencies` is enabled for React hooks, which catches missing dependencies in `useEffect`, `useCallback`, and `useMemo` dependency arrays. This will matter a lot in Phase 1 when the streaming hook has careful dependency management.

### The git pre-commit hook

Every `git commit` automatically runs:

```bash
pnpm type-check   # TypeScript strict mode — no type errors
pnpm lint          # Biome — no lint errors or warnings
pnpm test          # Jest — all tests pass
pnpm test:coverage # No coverage regression
```

If any step fails, the commit is rejected. There's no `--no-verify` escape hatch — the project's CLAUDE.md (more on that below) explicitly prohibits bypassing hooks, and an additional enforcement layer catches attempts to do so.

This means the `main` branch is always in a known-good state. Every commit type-checks, lints clean, and passes all tests. You can `git bisect` with confidence. You can read any commit in the history and know it was a working increment.

---

## The enforcement architecture

This is where Maude gets unusual. Most projects have a linter config and maybe a pre-commit hook. Maude has four layers of enforcement, and they're worth understanding because they reflect a deliberate philosophy: *the process is part of the product*.

### Layer 1: Git pre-commit hook

The shell script described above. Standard, widely understood, hard to argue with. This is the safety net that catches everything before it reaches the repository.

### Layer 2: Claude Code hooks

Maude is built with Claude Code — an AI coding assistant that operates in the terminal. Claude Code supports "hooks": shell commands that run automatically before or after specific tool calls. Maude uses three:

- **Pre-commit check** (`check-commit.js`): Intercepts `git commit` commands and runs the full test suite *before* the OS-level pre-commit hook fires. Belt and suspenders.

- **TASKS.md validation** (`check-tasks-write.js`): Intercepts any attempt to edit the task tracking file and validates that the edit preserves the document's structure — correct task IDs, valid dependency references, no accidentally deleted sections.

- **Post-commit signal** (`post-commit.js`): After a successful commit, signals that the `analyze-refactoring` skill should run. This is a read-only analysis that examines the commit diff for refactoring opportunities (mixed responsibilities, duplication, unclear naming). If it finds something, it creates a refactoring task that must be completed before the next feature task.

### Layer 3: CLAUDE.md — the project constitution

CLAUDE.md is a file at the project root that Claude Code reads on every invocation. It contains the project's non-negotiable rules:

- TypeScript strict mode, no `any`, no unexplained `as` casts
- No client component may import from `src/lib/server/`
- All `startTransition` and `useDeferredValue` usages must have comments explaining *why*
- The model adapter is the only file that references `OLLAMA_BASE_URL` or `MODEL_NAME`
- TDD workflow is mandatory: write failing tests first, implement minimum code, run checks, commit

Think of it as a `.editorconfig` for architectural decisions. It doesn't just format your code — it encodes the project's design principles in a form that's automatically enforced.

### Layer 4: The TDD workflow

This isn't a tool — it's a process, and it's enforced by the combination of the other three layers:

1. Read the task definition in TASKS.md
2. Write failing tests that specify the behavior
3. Implement the minimum code to make tests pass
4. Run the pre-commit check (type-check, lint, test, coverage)
5. Self-review every changed file
6. Commit (one commit per task)
7. Run the refactoring analysis
8. Mark the task done

Every task follows this sequence. The pre-commit hook verifies steps 3-4. The post-commit hook triggers step 7. TASKS.md tracks step 8. The process is mechanical and repeatable, which is exactly the point — it removes the "should I write tests for this?" question entirely. The answer is always yes, and you always write them first.

The "one commit per task" rule is worth highlighting. Each task in TASKS.md has a defined scope, a list of deliverables, and explicit test criteria. The commit message format reinforces this:

```
feat(T05): BFF route happy path streaming

Goal:        first end-to-end token flow from Ollama to HTTP response
Approach:    key technical decisions and why
Accomplished: bullet list of what is now true
Gaps:        known limitations
Next steps:  what follows and why it depends on this commit
```

This format means the git history reads like a project journal. You can `git log --oneline` and see the exact sequence of capabilities that were added. You can read any commit message and understand not just what changed, but *why* — what problem it solved, what trade-offs were made, and what comes next. For a pedagogical project, the git history *is* the curriculum.

### Why four layers?

You might think this is overkill. One pre-commit hook should be enough, right?

In practice, each layer catches different failure modes:

- The **git hook** catches commits that would break the build.
- The **Claude Code hooks** catch process violations before they become commits — editing TASKS.md incorrectly, skipping the refactoring step.
- **CLAUDE.md** catches architectural violations — importing server code from a client component, forgetting to comment a `startTransition`.
- The **TDD workflow** catches the most insidious problem of all: writing code that works but isn't tested, isn't understood, and can't be safely changed.

No single layer handles all of these. Together, they create a development environment where the *path of least resistance* is also the path that produces the highest-quality code. You don't need discipline to follow the process — the process is automated.

---

## TASKS.md: the build plan as a living document

TASKS.md deserves its own section because it's more than a TODO list. It's a dependency graph, a progress tracker, and a specification of what "done" means for each unit of work.

Each task entry looks like this:

```markdown
- [x] T05 — BFF route: happy path streaming
      User value: first end-to-end token flow from Ollama to HTTP response
      Deliverable: `src/app/api/chat/route.ts` (basic SSE emission, no abort yet)
      Depends: T01, T02, T04
      Test: MSW normal handler; event sequence (message_start → deltas →
        message_stop) reaches client; prompt_used field present in message_start
```

Every task has:
- **User value**: one sentence explaining why a user cares about this work. This forces you to connect infrastructure tasks to user-visible outcomes. T01 (SQLite schema) isn't just "set up the database" — it's "prerequisite for BFF to persist messages."
- **Deliverable**: the specific files that will be created or modified.
- **Depends**: which tasks must be complete first. This creates a DAG (directed acyclic graph) that determines build order.
- **Test**: what the tests must verify. This is written *before* the task begins — the test criteria are the spec.

The checkbox (`[ ]`, `[~]`, `[x]`) tracks status, and the TASKS.md validation hook ensures the document's structure stays valid as tasks are marked complete. You can't accidentally delete a task or break a dependency reference.

---

## The directory structure

After Phase 0, the project tree looks like this:

```
/workspace/
  src/                          # Empty — no feature code yet
    app/
    components/
    hooks/
    lib/
      client/
      server/
    mocks/
  .devcontainer/
    devcontainer.json            # VS Code dev container config
    Dockerfile                   # Node LTS + sqlite3
  .claude/
    settings.json                # Claude Code hooks configuration
    hooks/
      check-commit.js            # Pre-commit validation
      check-tasks-write.js       # TASKS.md structure validation
      post-commit.js             # Post-commit refactoring signal
      validate_tasks.js          # TASKS.md parser
    skills/
      run-pre-commit-check/      # Full test gate skill
      validate-tasks-edit/        # Auto-validates TASKS.md edits
      analyze-refactoring/        # Post-commit refactoring analysis
  migrations/                    # SQL migration files (empty — T01 adds the first)
  docker-compose.yml
  package.json                   # pnpm, Biome, Jest, Playwright
  tsconfig.json                  # strict: true
  biome.json                     # Linting + formatting rules
  CLAUDE.md                      # Project constitution
  TASKS.md                       # Build plan with task statuses
  SPEC.md                        # Full specification
```

Notice that `src/` is empty. The directory structure mirrors the final architecture — `app/`, `components/`, `hooks/`, `lib/client/`, `lib/server/`, `mocks/` — but contains no code. The skeleton is scaffolded in Phase 0; the code arrives in Phase 1.

This is the same principle as the pre-commit hook: have the structure in place before you need it, so every file you create lands in the right place from the start.

---

## The commit that started it all

Phase 0 is a single commit:

```
feat(T00): project skeleton, enforcement infrastructure, and dev container

Goal:        development environment is fully operational; all quality
             gates are in place before any feature work begins
Approach:    establish tooling, container, and enforcement before code
Accomplished:
  - package.json with pnpm, Biome, Jest, Playwright
  - tsconfig.json with strict mode
  - biome.json with project lint rules
  - Dev container with Node LTS + sqlite3
  - Git pre-commit hook (type-check, lint, test, coverage)
  - Claude Code hooks (commit check, TASKS.md validation, post-commit)
  - Three Claude Code skills (pre-commit check, task validation, refactoring)
  - CLAUDE.md, TASKS.md, SPEC.md
Gaps:        None known
Next steps:  T01 (SQLite schema) begins the feature work
```

One commit. Zero features. But after this commit, the project has:

- A reproducible development environment (dev container)
- A type-safe, lint-clean codebase (even though it's empty)
- Automated quality gates that block bad commits
- A clear specification of what will be built and in what order
- An enforcement architecture that keeps the process honest

This is the foundation everything else is built on.

---

## What's next

[Phase 1](./PHASE1.md) builds the end-to-end streaming pipeline: the database layer, the model adapter, the SSE parser, the BFF route, the React hook, the UI components, and the chat page that wires them all together. By the end of Phase 1, you can type a message and watch tokens stream in — the minimum viable proof that the architecture works.
