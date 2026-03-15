---
name: transition-docs
description: >
  Generate comprehensive transition documentation for handing off the Maude
  codebase to another engineer. Triggers on: "transition", "onboard",
  "document the codebase", "write READMEs", "knowledge transfer".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
context: fork
---

# Transition Documentation Generator

Generate self-explanatory documentation so a competent frontend engineer —
who may not know SSE streaming, React 19 concurrent features, Next.js 16
server components, BFF patterns, thinking block parsing, or MSW-based testing
— can own this codebase without access to the original author.

## Invocation

This skill accepts an optional phase argument:

- `/transition-docs` — run all four phases sequentially
- `/transition-docs phase1` — directory READMEs only
- `/transition-docs phase2` — enhanced header comments only
- `/transition-docs phase3` — test name audit only
- `/transition-docs phase4` — root README only

When running all phases, complete each phase fully before starting the next.

## Parallelization strategy

This skill generates a large volume of documentation. To manage context:

- **Phase 1 (READMEs)**: Spawn Agent subagents in batches. Each subagent
  handles 4-5 directories. Give each subagent the list of directories, the
  README format template, the quality principles, and the accuracy policy.
  Process leaf directories before parents (batch 1: items 1-5, batch 2: 6-9,
  batch 3: 10-13, batch 4: 14-17, batch 5: 18-22).
- **Phase 2 (headers)**: Spawn Agent subagents in batches of 3-4 files each.
  Each subagent receives the target file list and the "why" knowledge from
  `references/header-comment-targets.md`.
- **Phase 3 (test names)**: Spawn one Agent subagent per test directory
  (`hooks/__tests__/`, `components/chat/__tests__/`, etc.).
- **Phase 4 (root README)**: Single agent — needs to read multiple files
  but produces one output.

When spawning subagents, always include in the prompt:
1. The documentation accuracy policy (code is truth, verify against source)
2. The quality principles section
3. The specific directories/files to process
4. The README format template (for Phase 1) or header rules (for Phase 2)

## Audience assumptions

The receiving engineer:
- Is competent at frontend engineering broadly (React, TypeScript, REST APIs)
- May NOT know: SSE streaming, async generators, `startTransition` for
  non-navigation use cases, BFF streaming translation, thinking-tag state
  machines, MSW handler factories, `server-only` build-time enforcement,
  `requestAnimationFrame` coalescing for scroll, or discriminated unions as
  API contracts

## Documentation accuracy policy

**Document what IS, not what was.** All existing documentation (including
SPEC.md, files in `docs/`, READMEs, header comments) was AI-generated and
may be outdated — the codebase continued evolving after documentation was
written. Before documenting any module:

1. **Read the actual source code** — it is the single source of truth
2. **Cross-check against existing docs** — if SPEC.md, `docs/` files, or
   existing comments contradict the code, the code wins
3. **Rewrite freely** — do not preserve outdated or suboptimal documentation
   out of deference. Replace it whenever the code tells a different story
   or you can communicate more clearly

## Phase 1: Directory READMEs (bottom-up)

Write a `README.md` in each directory listed in
`references/directory-inventory.md`. Process **leaf directories first, then
parents** so parent READMEs can reference child READMEs.

Each README answers:
1. **What is in this directory and why does it exist?**
2. **What are the key architectural decisions scoped to this module?**
3. **How do the files relate to each other and to sibling/parent directories?**
4. **What would a new engineer modify first? What are the gotchas?**

### README format

```markdown
# <directory name>

<1-2 sentence purpose statement explaining WHY this directory exists>

## Files

| File | Purpose |
|------|---------|
| `file.ts` | One-line purpose |

## Architecture decisions

- **Decision**: rationale (link to SPEC.md/TASKS.md section if applicable)

## Relationships

- Depends on: <sibling/parent directories>
- Depended on by: <who imports from here>

## For new engineers

- **Modify first**: <most likely file to change and why>
- **Gotchas**: <non-obvious constraints, e.g. server-only boundary>
```

### Directory processing order (22 directories)

Process in this exact order (leaves first):

**Batch 1 — lib layer (leaves)**:
1. `src/lib/shared/`
2. `src/lib/client/`
3. `src/lib/server/migrations/`
4. `src/lib/server/`
5. `src/lib/`

**Batch 2 — mocks, hooks, context**:
6. `src/mocks/handlers/`
7. `src/mocks/`
8. `src/hooks/`
9. `src/context/`

**Batch 3 — components**:
10. `src/components/chat/`
11. `src/components/layout/`
12. `src/components/settings/`
13. `src/components/`

**Batch 4 — API routes**:
14. `src/app/api/chat/`
15. `src/app/api/conversations/`
16. `src/app/api/settings/`
17. `src/app/api/`

**Batch 5 — pages and top-level**:
18. `src/app/chat/`
19. `src/app/settings/`
20. `src/app/`
21. `src/`
22. `tests/e2e/`

### What NOT to create

- No READMEs in `__tests__/` directories — parent READMEs cover testing
- No READMEs in `node_modules/`, `.next/`, `docs/` (already self-explanatory)
- No READMEs in config-only directories

## Phase 2: Enhanced file header comments

For files where the "why" isn't obvious to an SSE/streaming newcomer, enhance
or add a block comment **before the first import**. Target files are listed in
`references/header-comment-targets.md`.

### Rules

- **Read each target file fully before editing** — document the code as it
  actually exists, not as earlier docs describe it
- If the existing header is inaccurate or not the best way to communicate,
  rewrite it entirely
- **Never modify executable code**: only comments change. Imports, logic,
  types — all untouched
- **Target confusion points**: what would a competent-but-SSE-naive engineer
  misunderstand on first read?
- Use the `references/header-comment-targets.md` checklist to verify each
  file's specific "why" knowledge is covered

## Phase 3: Test name audit

Review all `*.test.ts` and `*.test.tsx` files. For each `describe` and `it`
block, check that the description is BDD-style behavioral:

**Pattern**: `"when [context], it [expected behavior]"` or
`"[subject] [expected behavior] when [context]"`

**Anti-patterns to fix**:
- Implementation-focused: "calls setState" → "updates the message list"
- Vague: "works correctly" → "renders the full markdown output"
- Missing context: "handles error" → "when the stream errors mid-response,
  shows the partial content with an error indicator"

### Rules

- **Only modify string descriptions** (`describe('...')`, `it('...')`)
- **Never modify**: test logic, assertions, imports, setup/teardown, variable
  names, or any executable code
- Read each test file and understand what the test actually verifies before
  renaming

## Phase 4: Enhanced root README.md

Rewrite or enhance `/workspace/README.md` for a transition audience. The
existing README was AI-generated — rewrite freely if you can do better.
The goal is a document that a new engineer reads on day one to understand
the entire project. **Verify all claims against the actual code** — do not
carry forward outdated descriptions from the existing README.

### Key Concepts Glossary

Define each term in 2-3 sentences with a link to the relevant source file:

- **BFF (Backend-for-Frontend)**: `src/app/api/chat/route.ts`
- **SSE (Server-Sent Events)**: `src/lib/client/sseParser.ts`
- **startTransition**: `src/hooks/useStream.ts`
- **Discriminated union**: `src/lib/client/events.ts`
- **Thinking block**: `src/app/api/chat/route.ts`
- **Stall detection**: `src/hooks/useStallDetection.ts`
- **MSW (Mock Service Worker)**: `src/mocks/`
- **server-only boundary**: `src/lib/server/modelAdapter.ts`
- **Async generator**: `src/lib/client/sseParser.ts`

### End-to-End Data Flow Walkthrough

A narrative walkthrough for someone who hasn't seen SSE streaming. Reference
specific files at each stage. Draw from the architecture-map.md in
`maude-interview-prep/references/` but **verify against actual code** — the
architecture map may be outdated. Write for a standalone README audience.

### Mermaid Architecture Diagrams

- **Data flow**: user input → BFF → Ollama → SSE → client parser → React state → DOM
- **Module dependencies**: which modules import from which
- **Hook composition**: how useStream, useAutoScroll, useStallDetection,
  useObservabilityEvents compose in ChatShell

### "What This Project Deliberately Does NOT Do"

Conscious omissions with rationale. Verify each omission is still true by
checking the codebase — do not blindly copy from architecture-map.md:
- No reconnection/retry on stream failure
- No TransformStream pipeline
- No Zod runtime validation
- No external state library
- No RSC for the chat page
- SQLite not Postgres
- No WebSocket upgrade

### Directory Structure

Tree view with one-line descriptions and links to each directory's README.

### Further Reading

Link to SPEC.md, TASKS.md, CLAUDE.md for deeper context.

## Quality principles

- **Explain WHY, never restate WHAT** — the code already shows what
- **Code is truth** — read the source before writing about it; existing docs
  may be outdated
- **Link, don't duplicate** — reference SPEC.md/TASKS.md/CLAUDE.md sections
  instead of copying their content (but only after verifying those sections
  are still accurate)
- **Every README**: purpose, file inventory, architectural decisions,
  relationships, "modify first" guidance
- **Header comments**: target "what would confuse a competent engineer reading
  this for the first time?"
- **Test descriptions**: behavioral, not implementation-focused
- **Accuracy over volume** — read each file before documenting it; never
  guess at what code does
- **Rewrite freely** — all existing documentation is AI-generated; replace
  it whenever the code tells a different story or you can communicate more
  clearly

## Do NOT

- Create READMEs in `__tests__/`, `node_modules/`, `.next/`
- Duplicate SPEC.md, TASKS.md, or CLAUDE.md content
- Add trivial comments restating code (`// increment counter` above `count++`)
- Modify test assertions, imports, logic, or any executable code
- Document generated files or config files
- Add type annotations, docstrings, or comments to files not in the target list
- Carry forward documentation claims without verifying them against the code

## Verification (run after each phase)

After Phase 2: `pnpm type-check` — header comments must not break types
After Phase 3: `pnpm test` — test name changes must not break test execution
After Phase 4: Visually review the README for broken links and Mermaid syntax
